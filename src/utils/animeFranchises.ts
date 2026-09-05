/**
 * Standardizes raw anime titles to their master franchise names entirely locally,
 * removing the need for external API lookup.
 */
export function getMainAnimeName(name: string): string {
  if (!name) return '';
  const norm = name.trim();
  const lower = norm.toLowerCase();
  
  // Custom manual mappings for known franchises (covering both English and Japanese/Romaji titles)
  if (lower.includes('naruto')) return 'Naruto';
  if (lower.includes('evangelion') || lower.includes('shin seiki福音')) return 'Neon Genesis Evangelion';
  if (lower.includes('attack on titan') || lower.includes('shingeki no kyojin') || lower.includes('snk')) return 'Attack on Titan';
  if (lower.includes('sword art online') || lower.includes('sao')) return 'Sword Art Online';
  if (lower.includes('fullmetal alchemist') || lower.includes('hagane no renkinjutsushi') || lower.includes('fma') || lower.includes('fmab')) return 'Fullmetal Alchemist';
  if (lower.includes('hunter x hunter') || lower.includes('hxh')) return 'Hunter x Hunter';
  if (lower.includes('tokyo ghoul') || lower.includes('tokyoghoul')) return 'Tokyo Ghoul';
  if (lower.includes('fate/')) return 'Fate';
  if (lower.includes('jujutsu kaisen') || lower.includes('jjk')) return 'Jujutsu Kaisen';
  if (lower.includes('bleach')) return 'Bleach';
  if (lower.includes('demon slayer') || lower.includes('kimetsu no yaiba')) return 'Demon Slayer';
  if (lower.includes('k-on!')) return 'K-On!';
  if (lower.includes('fairy tail') || lower.includes('fairytail')) return 'Fairy Tail';
  if (lower.includes('one punch man') || lower.includes('opm')) return 'One Punch Man';
  if (lower.includes('haruhi suzumiya')) return 'The Melancholy of Haruhi Suzumiya';
  if (lower.includes('monogatari')) return 'Monogatari Series';
  if (lower.includes('clannad')) return 'Clannad';
  if (lower.includes('code geass') || lower.includes('hangyaku no lelouch')) return 'Code Geass';
  if (lower.includes('stein;gate') || lower.includes('steins;gate') || lower.includes('steins gate')) return 'Steins;Gate';
  if (lower.includes('my hero academia') || lower.includes('boku no hero') || lower.includes('mha')) return 'My Hero Academia';
  if (lower.includes('haikyuu') || lower.includes('haikyu!!') || lower.includes('haikyu')) return 'Haikyuu!!';
  if (lower.includes('chainsaw man') || lower.includes('chainsawman')) return 'Chainsaw Man';
  if (lower.includes('oshi no ko')) return 'Oshi no Ko';
  if (lower.includes('kekkai sensen') || lower.includes('blood blockade battlefront')) return 'Kekkai Sensen';
  if (lower.includes('death note') || lower.includes('deathnote')) return 'Death Note';
  if (lower.includes('parasyte') || lower.includes('kiseijuu')) return 'Parasyte';
  if (lower.includes('madoka magica') || lower.includes('mahou shoujo madoka')) return 'Puella Magi Madoka Magica';
  if (lower.includes('gurren lagann') || lower.includes('tengen toppa gurren lagann')) return 'Gurren Lagann';
  if (lower.includes('your lie in april') || lower.includes('shigatsu wa kimi no uso')) return 'Your Lie in April';
  if (lower.includes('erased') || lower.includes('boku dake ga inai machi')) return 'Erased';
  if (lower.includes('one piece')) return 'One Piece';
  if (lower.includes('ghibli') || lower.includes('totoro') || lower.includes('spirited away') || lower.includes('sen to chihiro')) return 'Studio Ghibli';
  
  // Generic fallback: strip season prefixes, movie subtitles, parentheses, and year parts
  let cleaned = name.replace(/(\s+Season\s+\d+|\s+Part\s+\d+|\s+\(\d+\)|\s+\(2011\)|\s+\d+(st|nd|rd|th)\s+season)/gi, '');
  cleaned = cleaned.split(/[:\-|~(|)]/)[0].trim();
  
  return cleaned || name;
}
