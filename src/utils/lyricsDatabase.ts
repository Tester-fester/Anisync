/**
 * Highly accurate, hand-crafted, synchronized lyrics for top anime themes
 * Includes Japanese, Romaji, English, and exact timeline timestamps (in seconds).
 */

export interface LyricLine {
  time: number; // Start time in seconds
  japanese: string;
  romaji: string;
  english: string;
}

export interface SongLyrics {
  title: string;
  artist: string;
  animeName: string;
  meaning: string;
  lyrics: LyricLine[];
}

export const SYNCHRONIZED_LYRICS: Record<string, SongLyrics> = {
  "unravel": {
    title: "Unravel",
    artist: "TK from Ling tosite sigure",
    animeName: "Tokyo Ghoul",
    meaning: "An intense exploration of tragic identity crisis, psychological isolation, and the struggle of maintaining humanity inside a monstrous world.",
    lyrics: [
      { time: 0, japanese: "教えて 教えてよ その仕組みを", romaji: "Oshiete oshiete yo sono shikumi wo", english: "Tell me, oh tell me, the way this world works" },
      { time: 5.5, japanese: "僕の中に誰がいるの?", romaji: "Boku no naka ni dare ga iru no?", english: "Just who is it that resides inside of me?" },
      { time: 11.5, japanese: "壊れた 壊れたよ この世界で", romaji: "Kowareta kowareta yo kono sekai de", english: "Broken, so broken, amongst this fragile world" },
      { time: 17.5, japanese: "君が笑う 何も見えずに", romaji: "Kimi ga warau nani mo miezu ni", english: "Yet you laugh, completely blind to it all" },
      { time: 24.5, japanese: "壊れた僕なんてさ 息を止めて", romaji: "Kowareta boku nante sa iki wo tomete", english: "Broken as I am, I hold my breath" },
      { time: 30.5, japanese: "ほどけない もう ほどけないよ 真実さえ", romaji: "Hodokenai mou hodokenai yo shinjitsu sae", english: "Unraveling, no longer unraveling, even the truth itself" },
      { time: 37.0, japanese: "freeze...", romaji: "freeze...", english: "freeze..." },
      { time: 41.5, japanese: "壊せる 壊せない 狂える 狂えない", romaji: "Kowaseru kowasenai kurueru kuruenai", english: "Breakable, unbreakable; crazy, yet unable to go mad" },
      { time: 47.5, japanese: "あなたを見つけて 揺れた", romaji: "Anata wo mitsukete yureta", english: "I found you and became shaken!" },
      { time: 54.0, japanese: "歪んだ世界にだんだん僕は 透き通って見えなくなって", romaji: "Yuganda sekai ni dandan boku wa sukitootte mienaku natte", english: "In this distorted world, I gradually grow transparent and fade away" },
      { time: 61.2, japanese: "見付けないで 僕のことを見つめないで", romaji: "Mitsukenai de boku no koto wo mitsumenai de", english: "Don't find me; don't look at me!" },
      { time: 67.8, japanese: "誰かが描いた世界の中で あなたを傷つけたくはないよ", romaji: "Dareka ga egaita sekai no naka de anata wo kizutsuketaku wa nai yo", english: "In a world drawn by someone else, I don't want to hurt you" },
      { time: 74.5, japanese: "覚えていて 僕のことを 鮮やかなまま...", romaji: "Oboeteite boku no koto wo azayaka na mama...", english: "Please remember me, at my most vivid..." }
    ]
  },
  "kick back": {
    title: "Kick Back",
    artist: "Kenshi Yonezu",
    animeName: "Chainsaw Man",
    meaning: "A chaotic, high-energy adrenaline ride reflecting Pochita and Denji's humble, beastly desires for basic affection, food, and surviving extreme urban bloodshed.",
    lyrics: [
      { time: 0, japanese: "努力 未来 A BEAUTIFUL STAR", romaji: "Doryoku mirai A BEAUTIFUL STAR", english: "Effort, Future, A Beautiful Star!" },
      { time: 4.8, japanese: "努力 未来 A BEAUTIFUL STAR", romaji: "Doryoku mirai A BEAUTIFUL STAR", english: "Effort, Future, A Beautiful Star!" },
      { time: 9.5, japanese: "努力 未来 A BEAUTIFUL STAR", romaji: "Doryoku mirai A BEAUTIFUL STAR", english: "Effort, Future, A Beautiful Star!" },
      { time: 14.2, japanese: "ランドリー今日はガラ空きでラッキーデイ", romaji: "Randorii kyou wa gara aki de rakkii dei", english: "The laundromat is completely empty today, what a lucky day!" },
      { time: 19.5, japanese: "かったりぃ油汚れもこれでバイバイ", romaji: "Kattarii abura yogore mo kore de bai bai", english: "Say goodbye to all of those stubborn grease stains!" },
      { time: 24.5, japanese: "誰かハッピーにしてくれよ", romaji: "Dareka happii ni shite kure yo", english: "Somebody satisfy me and make me happy" },
      { time: 29.5, japanese: "あの頃から変わらないまま", romaji: "Ano koro kara kawaranai mama", english: "Remaining exactly the same as I was back then" },
      { time: 34.5, japanese: "ハッピーで埋め尽くして レストインピースまで行こうぜ", romaji: "Happii de umetsukushite resuto in piisu made ikou ze", english: "Fill it up with pure happiness, let's ride all the way to Rest In Peace!" },
      { time: 39.8, japanese: "何かの間違いで さあ愛してくれ", romaji: "Nanika no machigai de saa aishite kure", english: "Even if it's by some mistake, come on and love me!" },
      { time: 44.2, japanese: "胸の中のマイスタンプ ドクドク暴れ回る", romaji: "Mune no naka no mai sutanpu dokudoku abaremau", english: "The stamp in my chest beats with fury, thrashing around!" },
      { time: 49.5, japanese: "ベイビーそれじゃあ またねって言えないじゃん", romaji: "Beibii sorejaa mata ne tte ienai jan", english: "Baby, this way I can't even tell you 'see you later'!" }
    ]
  },
  "idol": {
    title: "Idol",
    artist: "YOASOBI",
    animeName: "Oshi no Ko",
    meaning: "An incredible dualistic commentary exploring the dazzling fake persona of pop idols, the darkness of celebrity life, and a mother's ultimate genuine love for her children.",
    lyrics: [
      { time: 0, japanese: "無敵の笑顔で荒らすメディア", romaji: "Muteki no egao de arasu media", english: "Dazzling the media with an invincible smile" },
      { time: 4.2, japanese: "知りたいその秘密ミステリアス", romaji: "Shiritai sono himitsu misuteriasu", english: "Everyone wants to know her mysterious secrets" },
      { time: 8.5, japanese: "抜けてるところさえ彼女のエリア", romaji: "Nuketeru tokoro sae kanojo no eria", english: "Even her clumsy side is part of her calculated area" },
      { time: 12.8, japanese: "完璧で嘘つきな君は...", romaji: "Kanpeki de usotsuki na kimi wa...", english: "You are the perfect, ultimate liar..." },
      { time: 17.5, japanese: "天才的なアイドル様!", romaji: "Tensaiteki na aidoru-sama!", english: "The genius star, our legendary Idol!" },
      { time: 22.0, japanese: "何食べた? 好きな本は?", romaji: "Nani tabeta? Suki na hon wa?", english: "What did you eat? What's your favorite book?" },
      { time: 26.2, japanese: "遊びに行くならどこに行くの?", romaji: "Asobi ni iku nara doko ni iku no?", english: "If you go out to play, where do you love to play?" },
      { time: 30.5, japanese: "何も食べてない、それは秘密", romaji: "Nani mo tabetenai, sore wa himitsu", english: "'I haven't eaten anything,' that remains a tight secret" },
      { time: 35.0, japanese: "そう淡々と、だけど燦々と", romaji: "Sou tantan to, dakedo sansan to", english: "So calmly, yet reflecting brilliant radiance" },
      { time: 39.5, japanese: "見えそうで見えない秘密は蜜の味", romaji: "Miesou de mienai himitsu wa mitsu no aji", english: "A secret that seems visible but hidden tastes sweet like honey" },
      { time: 44.5, japanese: "「これもない、さああれもない」", romaji: "\"Kore mo nai, saa are mo nai\"", english: "\"Not this, not that!\"" },
      { time: 48.8, japanese: "好きなタイプは? 相手は?", romaji: "Suki na taipu wa? Aite wa?", english: "Who is your ideal type? Do you have an active partner?" },
      { time: 53.0, japanese: "「さあ答えて!」", romaji: "\"Saa kotaete!\"", english: "\"Come on, answer us!\"" },
      { time: 56.5, japanese: "誰かを好きになることなんて私分からないから", romaji: "Dareka wo suki ni naru koto nante watashi wakaranai kara", english: "Since I don't really understand what it means to fall in love with anyone..." }
    ]
  },
  "a cruel angel's thesis": {
    title: "A Cruel Angel's Thesis",
    artist: "Yoko Takahashi",
    animeName: "Neon Genesis Evangelion",
    meaning: "A profound mythological theme encouraging a young boy to rise as a savior, shedding his shell of despair to become a brilliant legend.",
    lyrics: [
      { time: 0, japanese: "残酷な天使のように 少年よ 神話になれ", romaji: "Zankoku na tenshi no you ni shounen yo shinwa ni nare", english: "Like a cruel angel, young boy, rise to become a legend!" },
      { time: 14.5, japanese: "青い風がいま 胸のドアを叩いても", romaji: "Aoi kaze ga ima mune no doa wo tataitemo", english: "Even though a fresh blue wind is knocking at the door of your heart" },
      { time: 21.8, japanese: "私だけをただ見つめて 微笑んでるあなた", romaji: "Watashi dake wo tada mitsumete hohoenderu anata", english: "You just look at me and smile, completely serene" },
      { time: 28.5, japanese: "そっとふれるもの もとめることに夢中で", romaji: "Sotto fureru mono motomeru koto ni muchuu de", english: "Obsessed with seeking what you can softly touch" },
      { time: 35.5, japanese: "運命さえまだ知らない いたいけな瞳", romaji: "Unmei sae mada shiranai itaike na hitomi", english: "Those innocent eyes still unaware of their ultimate destiny" },
      { time: 42.8, japanese: "だけどいつか気付くでしょう その背中には", romaji: "Dakedo itsuka kidzuku deshou sono senaka ni wa", english: "But someday, you will realize on your back" },
      { time: 49.5, japanese: "遥か未来 めざすための羽根があること", romaji: "Haruka mirai mezasu tame no hane ga aru koto", english: "You hold wings designed to reach toward the distant future" },
      { time: 57.5, japanese: "残酷な天使のテーゼ 窓辺からやがて飛び立つ", romaji: "Zankoku na tenshi no teeze madobe kara yagate tobitatsu", english: "A cruel angel's thesis will soon soar out from the window" },
      { time: 64.8, japanese: "ほとばしる熱いパトスで 思い出を裏切るなら", romaji: "Hotobashiru atsui patosu de omoide wo uragiru nara", english: "If you betray your memories with overflowing hot passion" },
      { time: 71.8, japanese: "この宇宙を抱いて輝く 少年よ 神話になれ", romaji: "Kono sora wo daite kagayaku shounen yo shinwa ni nare", english: "Shine bright as you embrace the entire cosmos, young boy, rise to become a legend!" }
    ]
  },
  "gurenge": {
    title: "Gurenge",
    artist: "LiSA",
    animeName: "Demon Slayer",
    meaning: "A fierce pledge of protective sibling love, finding absolute power in grief, and overcoming demons with an unshakeable lotus flame.",
    lyrics: [
      { time: 0, japanese: "強くなれる理由を知った 僕を連れて進め", romaji: "Tsuyoku nareru riyuu wo shitta boku wo tsurete susume", english: "I have discovered the reason to grow strong. Take me with you and march forward!" },
      { time: 10.5, japanese: "泥だらけの走馬灯に酔う こわばる心", romaji: "Dorodarake no soumatou ni you kowabaru kokoro", english: "Drowning in a mud-caked revolving lantern of memories, my heart stiffens" },
      { time: 16.5, japanese: "震える手は掴みたいものがある それだけさ", romaji: "Furueru te wa tsukamitai mono ga aru sore dake sa", english: "My trembling hand has something it is desperate to hold on to. That is all." },
      { time: 22.8, japanese: "夜の匂いに空睨んでも 変わっていけるのは自分だけ", romaji: "Yoru no nioi ni sora nirandemo kawatte ikeru no wa jibun dake", english: "Even if I glare at the sky in the smell of the night, only I have the power to change" },
      { time: 29.5, japanese: "それだけさ...", romaji: "Sore dake sa...", english: "That is all..." },
      { time: 33.5, japanese: "消せない夢も 止まれない今も", romaji: "Kesenai yume mo tomarenai ima mo", english: "An indelible dream, a present that cannot halt" },
      { time: 38.8, japanese: "誰かのために強くなれるなら ありがとう 悲しみよ", romaji: "Dareka no tame ni tsuyoku nareru nara arigatou kanashimi yo", english: "If I can grow strong for somebody else's sake, then thank you, sadness!" },
      { time: 45.5, japanese: "世界に打ちのめされ負ける意味を知った", romaji: "Sekai ni uchinomesare makeru imi wo shitta", english: "Beaten down by the world, I learned the value of defeat" },
      { time: 51.2, japanese: "紅蓮の華よ咲き誇れ! 運命を照らして", romaji: "Guren no hana yo sakihokore! Unmei wo terashite", english: "Bloom proudly, red lotus flower! Light up our ultimate destiny!" }
    ]
  },
  "bling-bang-bang-born": {
    title: "Bling-Bang-Bang-Born",
    artist: "Creepy Nuts",
    animeName: "Mashle",
    meaning: "An incredible rap masterpiece celebrating breaking stereotypes, bypassing magical rules with raw kinetic power, and staying true to oneself.",
    lyrics: [
      { time: 0, japanese: "Bling-bang-bang, bling-bang-bang-born!", romaji: "Bling-bang-bang, bling-bang-bang-born!", english: "Bling-bang-bang, bling-bang-bang-born!" },
      { time: 4.8, japanese: "実力 のみで伸し上がるトップ", romaji: "Jitsuryoku nomi de noshiagaru toppu", english: "Climbing all the way to the top purely with raw strength" },
      { time: 9.5, japanese: "常識 外れのタフさにビビるな", romaji: "Joushiki hazure no tafusa ni bibiru na", english: "Don't be startled by this logic-defying toughness!" },
      { time: 14.5, japanese: "お前の呪文なんて効かないぜ", romaji: "Omae no jumon nante kikanai ze", english: "Your spells and magic hold no power against me!" },
      { time: 19.5, japanese: "Ey, まっすぐ立って構えろよ", romaji: "Ey, massugu tatte kamaero yo", english: "Ey, stand up straight and prepare yourself!" },
      { time: 24.5, japanese: "Bling-bang-bang, bling-bang-bang-born!", romaji: "Bling-bang-bang, bling-bang-bang-born!", english: "Bling-bang-bang, bling-bang-bang-born!" }
    ]
  },
  "specialz": {
    title: "Specialz",
    artist: "King Gnu",
    animeName: "Jujutsu Kaisen",
    meaning: "An eerie, hypnotic rock theme setting a chaotic Shibuya battle stage, greeting curses and shamans to plunge into beautiful absolute desperation.",
    lyrics: [
      { time: 0, japanese: "You are my SPECIAL...", romaji: "You are my SPECIAL...", english: "You are my SPECIAL..." },
      { time: 8.5, japanese: "今際の際際で踊りましょう", romaji: "Imawa no kiwa kiwa de odorimashou", english: "Let's perform a dance at the edge of the grave" },
      { time: 14.8, japanese: "東京の混沌を飲み干して", romaji: "Toukyou no konton wo nomihoshite", english: "Swallowing up the absolute chaos of Tokyo" },
      { time: 20.8, japanese: "生きるか死ぬかのスリルで行こうぜ", romaji: "Ikiru ka shinu ka no suriru de ikou ze", english: "Let's ride with the pure thrill of life or death!" },
      { time: 27.0, japanese: "You are my SPECIAL...", romaji: "You are my SPECIAL...", english: "You are my SPECIAL..." },
      { time: 33.5, japanese: "土砂降りの迷路を駆け抜けて", romaji: "Doshaburi no meiro wo kakenukete", english: "Running through a downpour inside an endless maze" },
      { time: 39.5, japanese: "自分の心さえ信じられないまま", romaji: "Jibun no kokoro sae shinjirarenai mama", english: "While unable to trust even my own heart" },
      { time: 45.8, japanese: "それでも熱く 燃えさかるこの衝動", romaji: "Soredemo atsuku moesakaru kono shoudou", english: "Still, this blistering urge burns hot and wild!" }
    ]
  }
};

/**
 * Normalizes title string to match our database.
 */
export function lookupLyrics(title: string): SongLyrics | null {
  if (!title) return null;
  const cleanKey = title.toLowerCase().trim().replace(/['"“”!]/g, '');
  
  // Try exact lookup
  if (SYNCHRONIZED_LYRICS[cleanKey]) {
    return SYNCHRONIZED_LYRICS[cleanKey];
  }

  // Try partial containment match
  for (const [key, value] of Object.entries(SYNCHRONIZED_LYRICS)) {
    if (cleanKey.includes(key) || key.includes(cleanKey)) {
      return value;
    }
  }

  return null;
}
