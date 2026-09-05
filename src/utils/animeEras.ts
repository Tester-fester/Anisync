/**
 * Anime Eras and Release Years Helper
 */

const ANIME_YEAR_MAP: Record<string, number> = {
  "neon genesis evangelion": 1995,
  "evangelion": 1995,
  "tokyo ghoul": 2014,
  "fullmetal alchemist: brotherhood": 2009,
  "fullmetal alchemist": 2003,
  "fmab": 2009,
  "demon slayer": 2019,
  "kimetsu no yaiba": 2019,
  "one punch man": 2015,
  "naruto shippuden": 2007,
  "naruto": 2002,
  "attack on titan": 2013,
  "shingeki no kyojin": 2013,
  "jujutsu kaisen": 2020,
  "chainsaw man": 2022,
  "oshi no ko": 2023,
  "haikyuu!!": 2014,
  "haikyuu": 2014,
  "fate/stay night [ubw]": 2014,
  "fate/stay night recon": 2014,
  "fate/zero": 2011,
  "death note": 2006,
  "cowboy bebop": 1998,
  "code geass": 2006,
  "bleach": 2004,
  "steins;gate": 2011,
  "steins gate": 2011,
  "sword art online": 2012,
  "sao": 2012,
  "hunter x hunter": 2011,
  "black clover": 2017,
  "cyberpunk: edgerunners": 2022,
  "cyberpunk edgerunners": 2022,
  "mob psycho 100": 2016,
  "no game no life": 2014,
  "my hero academia": 2016,
  "boku no hero academia": 2016,
  "gurren lagann": 2007,
  "tengen toppa gurren lagann": 2007,
  "clannad: after story": 2008,
  "clannad": 2007,
  "toradora!": 2008,
  "toradora": 2008,
  "your lie in april": 2014,
  "shigatsu wa kimi no uso": 2014,
  "bakemonogatari": 2009,
  "k-on!": 2009,
  "k-on": 2009,
  "violet evergarden": 2018,
  "beastars": 2019,
  "vinland saga": 2019,
  "parasyte -the maxim-": 2014,
  "parasyte": 2014,
  "fire force": 2019,
  "jojo's bizarre adventure": 2012,
  "jojo": 2012,
  "serial experiments lain": 1998,
  "flcl": 2000,
  "fooly cooly": 2000,
  "cardcaptor sakura": 1998,
  "sailor moon": 1992,
  "trigun": 1998,
  "yu yu hakusho": 1992,
  "initial d": 1998,
  "great teacher onizuka": 1999,
  "gto": 1999,
  "revolutionary girl utena": 1997,
  "princess mononoke": 1997,
  "akira": 1988,
  "mobile suit gundam wing": 1995,
  "gundam wing": 1995,
  "slayers": 1995,
  "rurouni kenshin": 1996,
  "pokémon": 1997,
  "pokemon": 1997,
  "digimon adventure": 1999,
  "digimon": 1999,
  "one piece": 1999,
  "elfen lied": 2004,
  "soul eater": 2008,
  "angel beats!": 2010,
  "angel beats": 2010,
  "puella magi madoka magica": 2011,
  "madoka magica": 2011,
  "ouran high school host club": 2006,
  "kill la kill": 2013,
  "noragami": 2014,
  "re:zero": 2016,
  "darling in the franxx": 2018,
  "frieren": 2023,
  "frieren: beyond journey's end": 2023,
  "sousou no frieren": 2023,
  "solo leveling": 2024,
  "kaiju no. 8": 2024,
  "wind breaker": 2024,
  "mashle": 2023,
  "mashle: magic and muscles": 2023,
  "lycoris recoil": 2022,
  "bocchi the rock!": 2022,
  "bocchi the rock": 2022,
  "guilty crown": 2011,
  "erased": 2016,
  "another": 2012,
  "mirai nikki": 2011,
  "future diary": 2011,
  "nichijou": 2011,
  "overlord": 2015,
  "tokyo revengers": 2021,
  "holographic": 2020,
  "spy x family": 2022,
  "hell's paradise": 2023,
  "jigokuraku": 2023,
  "bleach: thousand-year blood war": 2022,
  "mob psycho 100 ii": 2019,
  "mob psycho 100 iii": 2022,
  "kaguya-sama: love is war": 2019,
  "kaguya-sama": 2019,
  "made in abyss": 2017,
  "highschool of the dead": 2010,
  "deadman wonderland": 2011,
  "gintama": 2006,
  "durarara!!": 2010,
  "durarara": 2010,
  "assassination classroom": 2015,
  "kuroko no basket": 2012,
  "noragami aragoto": 2015,
  "charlotte": 2015,
  "no game no life zero": 2017,
  "sao: alicization": 2018,
  "bunny girl senpai": 2018,
  "rascal does not dream of bunny girl senpai": 2018,
  "the rising of the shield hero": 2019,
  "shield hero": 2019,
  "dr. stone": 2019,
  "dr stone": 2019,
  "fire force season 2": 2020,
  "mushoku tensei": 2021,
  "jobless reincarnation": 2021,
  "blue lock": 2022,
  "cyberpunk": 2022,
  "nier: automata ver1.1a": 2023,
  "the boy and the heron": 2023,
  "kimetsu no yaiba: hashira training arc": 2024,
  "gundam: requiem for vengeance": 2024,
  "dandadan": 2024
};

export interface EraInfo {
  id: string;
  name: string;
  yearRange: string;
  colorClass: string;
  badgeBg: string; // Tailwind styling e.g. "bg-vermillion/10 text-vermillion"
  description: string;
}

export const ERAS: EraInfo[] = [
  {
    id: 'retro',
    name: 'Retro Gold',
    yearRange: 'Pre-2000s',
    colorClass: 'text-burnt',
    badgeBg: 'bg-burnt/10 text-burnt border border-burnt/20',
    description: 'The golden age of hand-drawn cells, heavy synths, and legendary masterpieces like Evangelion and Bebop.'
  },
  {
    id: 'classic',
    name: 'Classic Millennial',
    yearRange: '2000 - 2009',
    colorClass: 'text-brand-secondary',
    badgeBg: 'bg-brand-secondary/10 text-brand-secondary border border-brand-secondary/20',
    description: 'The digital production boom. Classic battle shonens and emotional landmarks like Naruto, Death Note, and Toradora.'
  },
  {
    id: 'modern',
    name: 'Modern Heisei',
    yearRange: '2010 - 2019',
    colorClass: 'text-vermillion',
    badgeBg: 'bg-vermillion/10 text-vermillion border border-vermillion/20',
    description: 'The era of HD spectacles, dark fantasies, and high-tier cinematic ops: Attack on Titan, Tokyo Ghoul, and Demon Slayer.'
  },
  {
    id: 'reiwa',
    name: 'New Horizon / Reiwa',
    yearRange: '2020+',
    colorClass: 'text-gold-bright',
    badgeBg: 'bg-indigo-ink/10 text-gold-bright border border-indigo-ink/20',
    description: 'The current vanguard. Visual powerhouses and subversion of genres: Jujutsu Kaisen, Chainsaw Man, and Frieren.'
  }
];

export function getAnimeEraAndYear(animeName: string): { eraId: string; eraName: string; year: number } {
  const normName = animeName.toLowerCase().trim();
  
  // 1. Try exact or partial lookup in database
  let detectedYear: number | null = null;
  for (const [key, value] of Object.entries(ANIME_YEAR_MAP)) {
    if (normName === key || normName.includes(key) || key.includes(normName)) {
      detectedYear = value;
      break;
    }
  }

  // 2. Try regex to see if year tag is in the anime name string like (2023) or [1995]
  if (!detectedYear) {
    const yearMatch = animeName.match(/\b(19\d{2}|20\d{2})\b/);
    if (yearMatch) {
      detectedYear = parseInt(yearMatch[0], 10);
    }
  }

  // 3. Fallback to reasonable default (e.g. 2015 - Heisei)
  const finalYear = detectedYear || 2015;

  let eraId = 'modern';
  let eraName = 'Modern Heisei';

  if (finalYear < 2000) {
    eraId = 'retro';
    eraName = 'Retro Gold';
  } else if (finalYear >= 2000 && finalYear < 2010) {
    eraId = 'classic';
    eraName = 'Classic Millennial';
  } else if (finalYear >= 2010 && finalYear < 2020) {
    eraId = 'modern';
    eraName = 'Modern Heisei';
  } else {
    eraId = 'reiwa';
    eraName = 'New Horizon / Reiwa';
  }

  return { eraId, eraName, year: finalYear };
}
