import { AdminPokedex } from './AdminPokedex';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { ContributionProposal, AnimeTrack, TrackType } from '../types';
import { 
  CheckCircle, 
  XCircle, 
  Clock, 
  User, 
  ExternalLink, 
  Sparkles, 
  Check, 
  AlertCircle,
  FileText,
  Video,
  Database,
  Search,
  Loader2,
  RefreshCw,
  Tag,
  Edit,
  Trash2,
  Plus,
  Play,
  Eye,
  Sliders,
  Activity,
  Award,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Image as ImageIcon,
  Key,
  Filter,
  CheckCircle2,
  Info,
  Layers,
  Code,
  Music,
  Tv,
  Camera,
  Download,
  Youtube,
  LayoutTemplate,
  MousePointer2
} from '@/utils/icons';
import { motion, AnimatePresence } from 'motion/react';
import YoutubePlayer from './YoutubePlayer';
import { 
  updateTrackTagsInDb, 
  updateTrackImageUrlInDb,
  addTrackToDb,
  updateTrackYtIdInDb,
  updateTrackAnimeNameInDb,
  updateTrackInDb,
  deleteTrackFromDb,
  getArtistProfile,
  saveArtistProfile,
  subscribeArtistProfiles
} from '../utils/firestoreService';
import { toast } from 'sonner';
import { confirm } from '../utils/confirm';
import { getMainAnimeName } from '../utils/animeFranchises';
import { apiFetch } from '../utils/apiFetch';
import { ModerationDashboard } from './ModerationDashboard';
import { generateId } from '../utils/autoId';

interface AdminQueueProps {
  proposals: ContributionProposal[];
  tracks: AnimeTrack[];
  onApproveProposal: (proposalId: string) => void;
  onRejectProposal: (proposalId: string, reason?: string) => void;
  onClearHistory: () => void;
  onUpdateTrackYtId: (id: string, newYtId: string) => void;
  onUpdateTrackAnimeName?: (id: string, newAnimeName: string, newAnimePart?: string) => void;
  onRemoveDuplicates?: (onProgress?: (msg: string) => void) => Promise<void>;
  onBulkAddTracks?: (tracks: AnimeTrack[]) => Promise<number>;
  onDeleteTracksBatch?: (ids: string[]) => Promise<void>;
}

const COMMON_TAGS = [
  'Action', 'Synthesizer', 'Alternative Rock', 'Epic', 'Classic', 
  'Hype', 'Melancholic', 'Orchestral', 'Heavy Metal', 'Jazz', 
  'Future Bass', 'Acoustic', 'Nostalgic', 'Legendary', 'BGM', 'Vocals'
];

const isOpeningOrEnding = (title: string): boolean => {
  const lower = title.toLowerCase();
  
  // Generic background OST titles (like Main Theme, Action Theme, character themes) should NOT be filtered out or flagged as OP/ED
  if (lower.includes("theme") && !lower.includes("opening theme") && !lower.includes("ending theme")) {
    return false;
  }

  const isOp = lower.includes("opening") || /\bop\s*\d+\b/i.test(lower) || /\bop\d+\b/i.test(lower) || lower.includes("op/");
  const isEd = lower.includes("ending") || /\bed\s*\d+\b/i.test(lower) || /\bed\d+\b/i.test(lower) || lower.includes("ed/");
  const isTv = lower.includes("tv size") || lower.includes("tv-size") || lower.includes("tv ver");

  return isOp || isEd || isTv;
};

// TrackDetailPanel — shows themes grouped by anime entry name.
// You can select/deselect entire sub-anime groups (e.g., "Attack on Titan Season 1" vs "Season 2").
// Individual track selection is also possible for fine-tuning.
function TrackDetailPanel({ animeTitle, isMovie, onTrackTypeOverride, typeOverrides, defaultType, onDefaultTypeChange, onSelectedTracksChange }: {
  animeTitle: string;
  isMovie: boolean;
  onTrackTypeOverride: (trackId: string, type: 'OP' | 'ED' | 'OST') => void;
  typeOverrides: Record<string, 'OP' | 'ED' | 'OST'>;
  defaultType: 'AUTO' | 'OP' | 'ED' | 'OST';
  onDefaultTypeChange: (t: 'AUTO' | 'OP' | 'ED' | 'OST') => void;
  onSelectedTracksChange: (selectedTrackIndices: number[]) => void;
}) {
  const [tracks, setTracks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  // Which anime-entry groups are expanded
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!animeTitle) return;
    setLoading(true);
    setSelectedIndices(new Set()); // Start with NOTHING selected — user picks which sub-anime to include
    apiFetch(`/api/animethemes-search?animeName=${encodeURIComponent(animeTitle)}`).then(r => r.json()).then(d => {
      const t = d.tracks || [];
      setTracks(t);
      // Auto-expand ALL groups so the user sees everything immediately
      const allNames = new Set<string>();
      t.forEach((track: any) => allNames.add(track.animeName || animeTitle));
      setExpandedGroups(allNames);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [animeTitle]);

  // Notify parent when selection changes
  useEffect(() => {
    onSelectedTracksChange(Array.from(selectedIndices).sort((a, b) => a - b));
  }, [selectedIndices, onSelectedTracksChange]);

  if (loading) return <div className="py-3 text-center"><Loader2 className="w-4 h-4 animate-spin text-vermillion inline" /></div>;
  if (tracks.length === 0) return <p className="text-[10px] text-zinc-500 py-2">No themes found for this anime.</p>;

  // Group tracks by their animeName (the sub-anime entry)
  const groups: Record<string, { tracks: { track: any; index: number }[] }> = {};
  tracks.forEach((track: any, i: number) => {
    const name = track.animeName || animeTitle;
    if (!groups[name]) groups[name] = { tracks: [] };
    groups[name].tracks.push({ track, index: i });
  });
  const groupNames = Object.keys(groups);

  const toggleGroup = (name: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const selectAllInGroup = (name: string) => {
    setSelectedIndices(prev => {
      const next = new Set(prev);
      groups[name].tracks.forEach(({ index }) => next.add(index));
      return next;
    });
  };

  const deselectAllInGroup = (name: string) => {
    setSelectedIndices(prev => {
      const next = new Set(prev);
      groups[name].tracks.forEach(({ index }) => next.delete(index));
      return next;
    });
  };

  const isGroupFullySelected = (name: string) => {
    return groups[name].tracks.every(({ index }) => selectedIndices.has(index));
  };

  return (
    <div className="mt-2 space-y-2 p-2 bg-zinc-950 rounded-lg border border-zinc-800">
      {/* Default type override */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[9px] font-mono text-zinc-500 uppercase">Default Type:</span>
        {(['AUTO', 'OP', 'ED', 'OST'] as const).map(t => (
          <button key={t} onClick={() => onDefaultTypeChange(t)}
            className={`px-1.5 py-0.5 rounded text-[8px] font-mono font-black uppercase ${defaultType === t ? 'bg-vermillion text-white' : 'bg-zinc-900 text-zinc-500 hover:text-zinc-300'}`}>
            {t === 'AUTO' && isMovie ? 'AUTO-OST' : t}
          </button>
        ))}
        <span className="text-[8px] text-zinc-600 ml-auto">{selectedIndices.size}/{tracks.length} tracks selected</span>
      </div>

      {/* Grouped by anime entry name */}
      <div className="space-y-1.5 max-h-[350px] overflow-y-auto">
        {groupNames.map(name => {
          const isExpanded = expandedGroups.has(name);
          const fullySelected = isGroupFullySelected(name);
          return (
            <div key={name} className="border border-zinc-800 rounded-lg overflow-hidden">
              {/* Group header — click to toggle entire group */}
              <div className="flex items-center gap-2 p-2 bg-zinc-900 cursor-pointer hover:bg-zinc-800 transition-colors"
                onClick={() => fullySelected ? deselectAllInGroup(name) : selectAllInGroup(name)}
              >
                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${fullySelected ? 'bg-vermillion border-vermillion' : 'border-zinc-600'}`}>
                  {fullySelected && <Check className="w-2.5 h-2.5 text-white" />}
                </div>
                <span className="text-[10px] font-bold text-white truncate flex-1">{name}</span>
                <span className="text-[8px] text-zinc-500 shrink-0">{groups[name].tracks.length} tracks</span>
                <button
                  onClick={(e) => { e.stopPropagation(); toggleGroup(name); }}
                  className="text-zinc-500 hover:text-white text-[10px] px-1"
                >
                  {isExpanded ? '−' : '+'}
                </button>
              </div>
              {/* Track list for this group (expandable) */}
              {isExpanded && (
                <div className="p-1 space-y-0.5 bg-zinc-950">
                  {groups[name].tracks.map(({ track, index }) => {
                    const id = `${track.title}_${track.type}_${index}`;
                    const isSelected = selectedIndices.has(index);
                    const effectiveType = typeOverrides[id]
                      || (defaultType !== 'AUTO' ? defaultType : null)
                      || (defaultType === 'AUTO' && isMovie ? 'OST' : null)
                      || track.type;
                    return (
                      <div key={index} className={`flex items-center gap-2 p-1 rounded ${isSelected ? 'bg-vermillion/5' : ''}`}>
                        <button onClick={() => {
                          setSelectedIndices(prev => {
                            const next = new Set(prev);
                            if (next.has(index)) next.delete(index);
                            else next.add(index);
                            return next;
                          });
                        }} className="shrink-0">
                          <div className={`w-3 h-3 rounded border flex items-center justify-center ${isSelected ? 'bg-vermillion border-vermillion' : 'border-zinc-600'}`}>
                            {isSelected && <Check className="w-2 h-2 text-white" />}
                          </div>
                        </button>
                        <span className="text-[9px] text-white truncate flex-1">{track.title}</span>
                        <span className="text-[8px] text-zinc-600 truncate hidden sm:block max-w-[80px]">{track.artist}</span>
                        <select value={effectiveType} onChange={(e) => onTrackTypeOverride(id, e.target.value as 'OP' | 'ED' | 'OST')}
                          className={`shrink-0 px-1 py-0.5 rounded text-[8px] font-mono font-black uppercase bg-zinc-900 border border-zinc-700 cursor-pointer ${effectiveType === 'OP' ? 'text-gold-bright' : effectiveType === 'ED' ? 'text-vermillion' : 'text-burnt'}`}>
                          <option value="OP">OP</option>
                          <option value="ED">ED</option>
                          <option value="OST">OST</option>
                        </select>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[8px] text-zinc-600 italic">Click an anime title to select/deselect all its tracks. Click + to expand and fine-tune individual tracks.</p>
    </div>
  );
}

export default function AdminQueue({
  proposals,
  tracks,
  onApproveProposal,
  onRejectProposal,
  onClearHistory,
  onUpdateTrackYtId,
  onUpdateTrackAnimeName,
  onRemoveDuplicates,
  onBulkAddTracks,
  onDeleteTracksBatch,
}: AdminQueueProps) {
  // Navigation: 'proposals' | 'catalog' | 'maintenance' | 'sandbox' | 'artists' | 'ui-lab'
  const [activeTab, setActiveTab] = useState<'proposals' | 'catalog' | 'maintenance' | 'sandbox' | 'artists' | 'pokedex' | 'ui-lab'>('proposals');
  const [proposalFilter, setProposalFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');

  // Artist profiles states
  const [artistProfiles, setArtistProfiles] = useState<any[]>([]);
  const [artistSearch, setArtistSearch] = useState('');
  const [editingArtist, setEditingArtist] = useState<any | null>(null);
  const [artistEditorName, setArtistEditorName] = useState('');
  const [artistEditorImage, setArtistEditorImage] = useState('');
  const [artistEditorBio, setArtistEditorBio] = useState('');
  const [artistEditorBirthday, setArtistEditorBirthday] = useState('');
  const [artistEditorWebsite, setArtistEditorWebsite] = useState('');
  const [artistEditorMal, setArtistEditorMal] = useState('');
  const [isSavingArtist, setIsSavingArtist] = useState(false);
  const [isSuggestingArtistImage, setIsSuggestingArtistImage] = useState(false);
  const [isBatchArtistCrawling, setIsBatchArtistCrawling] = useState(false);

  useEffect(() => {
    const unsub = subscribeArtistProfiles((profiles) => {
      setArtistProfiles(profiles);
    });
    
    // Restore bulk start page from cache if it exists
    const cachedPage = localStorage.getItem('bulkStartPage');
    if (cachedPage) {
      const parsed = parseInt(cachedPage);
      if (!isNaN(parsed) && parsed > 0) {
        setBulkStartPage(parsed);
      }
    }

    return () => unsub();
  }, []);
  
  // Modals & Single-item states
  const [rejectionNotes, setRejectionNotes] = useState<{ [id: string]: string }>({});
  const [activeRejectingId, setActiveRejectingId] = useState<string | null>(null);
  const [isResolvingId, setIsResolvingId] = useState<string | null>(null);
  const [previewYtId, setPreviewYtId] = useState<string | null>(null);
  
  // Track Editor states
  const [editingTrack, setEditingTrack] = useState<AnimeTrack | null>(null);
  const [editorTitle, setEditorTitle] = useState('');
  const [editorArtist, setEditorArtist] = useState('');
  const [editorAnime, setEditorAnime] = useState('');
  const [editorPart, setEditorPart] = useState('');
  const [editorYtoolsId, setEditorYtoolsId] = useState('');
  const [editorCover, setEditorCover] = useState('');
  const [editorTags, setEditorTags] = useState<string[]>([]);
  const [editorType, setEditorType] = useState<TrackType>('OP');
  const [isSavingTrack, setIsSavingTrack] = useState(false);
  const [isSuggestingCover, setIsSuggestingCover] = useState(false);

  // Database Catalog filters & pagination
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogTypeFilter, setCatalogTypeFilter] = useState<'ALL' | 'OP' | 'ED' | 'OST'>('ALL');
  const [catalogCoverageFilter, setCatalogCoverageFilter] = useState<'ALL' | 'MISSING_COVER' | 'MISSING_TAGS' | 'MISSING_MAL_PART' | 'HIGH_ELO'>('ALL');
  const [catalogPage, setCatalogPage] = useState(1);
  const itemsPerPage = 12;

  // Batch Maintenance Operations States
  const [isBatchResolving, setIsBatchResolving] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);
  const [batchLogs, setBatchLogs] = useState<string[]>([]);
  const [isPurgingAnomalies, setIsPurgingAnomalies] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState(false);

  // Gemini Auto-Tagger States
  const [isTagging, setIsTagging] = useState(false);
  const [taggingProgress, setTaggingProgress] = useState(0);
  const [taggingTotal, setTaggingTotal] = useState(0);

  // Terminal auto-scrolling
  const logsEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [batchLogs]);

  // Iconic OST Discovery States
  const [isOstDiscovering, setIsOstDiscovering] = useState(false);
  const [ostDiscoveryProgress, setOstDiscoveryProgress] = useState(0);
  const [ostDiscoveryTotal, setOstDiscoveryTotal] = useState(0);

  // Bulk Importer States
  const [isBulkImporting, setIsBulkImporting] = useState(false);
  const [bulkImportProgress, setBulkImportProgress] = useState(0);
  const [bulkImportTotal, setBulkImportTotal] = useState(0);
  const [bulkImportLimit, setBulkImportLimit] = useState(50);
  const [bulkKeepOrder, setBulkKeepOrder] = useState(true);
  const [bulkStartPage, setBulkStartPage] = useState(1);

  // Interactive Smart Import States
  const [interactiveAnimeList, setInteractiveAnimeList] = useState<any[]>([]);
  const [interactiveStep, setInteractiveStep] = useState(0);
  const [interactiveThemes, setInteractiveThemes] = useState<any[]>([]);
  const [interactiveLoadingThemes, setInteractiveLoadingThemes] = useState(false);
  const [interactiveSelectedTracks, setInteractiveSelectedTracks] = useState<Set<string>>(new Set());
  const [interactiveTypeFilter, setInteractiveTypeFilter] = useState<'ALL' | 'OP' | 'ED' | 'OST'>('ALL');
  const [interactiveImportedCount, setInteractiveImportedCount] = useState(0);
  const [interactivePageInfo, setInteractivePageInfo] = useState<{currentPage: number; hasNextPage: boolean; lastPage: number} | null>(null);
  // Per-track type overrides: { "title_type_index" => "OP" | "ED" | "OST" }
  const [interactiveTypeOverrides, setInteractiveTypeOverrides] = useState<Record<string, 'OP' | 'ED' | 'OST'>>({});
  // Default type override for ALL tracks of current anime (e.g. movies → OST)
  const [interactiveDefaultType, setInteractiveDefaultType] = useState<'AUTO' | 'OP' | 'ED' | 'OST'>('AUTO');
  // Phase: 'anime-select' = picking anime, 'track-select' = picking tracks, 'done' = finished
  const [interactivePhase, setInteractivePhase] = useState<'anime-select' | 'track-select' | 'done'>('anime-select');
  // Which anime the user selected (indices into interactiveAnimeList)
  const [interactiveSelectedAnime, setInteractiveSelectedAnime] = useState<Set<number>>(new Set());
  // Which selected anime we're currently showing tracks for
  const [interactiveTrackStep, setInteractiveTrackStep] = useState(0);
  // Per-anime selected track indices: { animeIndex => number[] }
  // If not set for an anime, ALL tracks are imported (default).
  const [interactiveTrackSelections, setInteractiveTrackSelections] = useState<Record<number, number[]>>({});

  // AI MyAnimeList Realignment States
  const [isAligningMAL, setIsAligningMAL] = useState(false);
  const [alignProgress, setAlignProgress] = useState(0);
  const [alignTotal, setAlignTotal] = useState(0);

  // UI Screenshot Lab States
  const [selectedCombinations, setSelectedCombinations] = useState<string[]>([
    'leaderboard', 'arena', 'tournament', 'search', 'artist_wiki', 'anime_wiki', 'player_active', 'submissions', 'admin_dashboard', 'onboarding_step0', 'onboarding_step1', 'login_modal', 'user_profile_tab', 'profile_overlay', 'tourney_builder', 'track_preview', 'clash_panel', 'playlists_tab', 'search_filters'
  ]);
  const [screenshotDelay, setScreenshotDelay] = useState<number>(1200);
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [currentCaptureIndex, setCurrentCaptureIndex] = useState<number>(-1);
  const [capturedImages, setCapturedImages] = useState<{ id: string; name: string; dataUrl: string }[]>([]);
  const [labLogs, setLabLogs] = useState<string[]>([
    '// Ready to launch automated UI Tour cycles...'
  ]);
  const [screenshotEngine, setScreenshotEngine] = useState<'html2canvas' | 'html-to-image'>('html2canvas');

  const captureScreenshot = async (name: string, selector: string = 'body'): Promise<string | null> => {
    const el = selector === 'body' ? document.documentElement : (document.querySelector(selector) || document.documentElement);
    const html2canvasEl = el === document.documentElement ? document.body : (el as HTMLElement);
    try {
      if (screenshotEngine === 'html-to-image') {
        const { toPng } = await import('html-to-image');
        const dataUrl = await toPng(el as HTMLElement, {
          backgroundColor: '#0A0805',
          cacheBust: true,
          style: {
            transform: 'none',
            transformOrigin: 'top left'
          }
        });
        return dataUrl;
      } else {
        const htmlToCanvasModule = (await import('html2canvas')).default;
        const canvas = await htmlToCanvasModule(html2canvasEl, {
          backgroundColor: '#0A0805',
          useCORS: true,
          allowTaint: true,
          scale: 1.5,
          logging: false
        });
        return canvas.toDataURL('image/png');
      }
    } catch (err: any) {
      console.warn("Screenshot capture error:", err);
      return null;
    }
  };

  const runAutomatedCaptureSequence = async () => {
    const control = (window as any).__controlAppForScreenshots;
    const onboard = (window as any).__controlOnboarding;
    if (!control) {
      toast.error("UI control bridge is not initialized. Please reload the main application page.");
      return;
    }

    setIsCapturing(true);
    setCapturedImages([]);
    const logsList: string[] = ["[INIT] Starting programmatic UI Screenshot cycle..."];
    setLabLogs(logsList);
    toast.loading("Starting automated UI combination tour...", { id: "lab-loader" });

    // Store state to restore at the end
    const restoredState = control.getCurrentState();

    const allSteps = [
      {
        id: 'leaderboard',
        name: '01_Leaderboard_Home_View',
        label: 'Leaderboard Home (Main Feed)',
        action: async () => {
          control.setActiveTab('leaderboard');
          control.setActiveWiki(null);
          control.setViewedProfileId(null);
          if (onboard) onboard.setIsOpen(false);
        }
      },
      {
        id: 'arena',
        name: '02_Voting_Arena_Matchup_View',
        label: 'Endless 1v1 Voting Arena Matchup',
        action: async () => {
          control.setActiveTab('arena');
          control.setActiveWiki(null);
          control.setViewedProfileId(null);
          if (onboard) onboard.setIsOpen(false);
        }
      },
      {
        id: 'tournament',
        name: '03_Championship_Tournament_Bracket_View',
        label: 'Interactive Tournament Bracket Championship',
        action: async () => {
          control.setActiveTab('tournament');
          control.setActiveWiki(null);
          control.setViewedProfileId(null);
          if (onboard) onboard.setIsOpen(false);
        }
      },
      {
        id: 'search',
        name: '04_Track_Detailed_Database_Explorer_View',
        label: 'Database Explorer / Detailed Filters Search',
        action: async () => {
          control.setActiveTab('detailed_search');
          control.setActiveWiki(null);
          control.setViewedProfileId(null);
          if (onboard) onboard.setIsOpen(false);
        }
      },
      {
        id: 'artist_wiki',
        name: '05_Artist_Biography_Wiki_Overlay_Active',
        label: 'Artist Performer Bio Wiki Overlay',
        action: async () => {
          control.setActiveTab('leaderboard');
          control.setActiveWiki({ type: 'artist', key: 'LiSA' });
          if (onboard) onboard.setIsOpen(false);
        }
      },
      {
        id: 'anime_wiki',
        name: '06_Anime_Soundtrack_Wiki_Overlay_Active',
        label: 'Anime Franchise soundtrack Wiki Overlay',
        action: async () => {
          control.setActiveTab('leaderboard');
          control.setActiveWiki({ type: 'anime', key: 'Evangelion' });
          if (onboard) onboard.setIsOpen(false);
        }
      },
      {
        id: 'player_active',
        name: '07_Active_Media_Audio_Player_Footer_Expanded',
        label: 'Expanded Bottom Deck Media Player Station',
        action: async () => {
          control.setActiveTab('leaderboard');
          control.setActiveWiki(null);
          if (control.tracks && control.tracks.length > 0) {
            control.setGlobalPlayingTrack(control.tracks[0]);
          }
          if (onboard) onboard.setIsOpen(false);
        }
      },
      {
        id: 'submissions',
        name: '08_User_Submissions_Proposals_Queue_View',
        label: 'Suggestions Box Submission Portal',
        action: async () => {
          control.setActiveTab('submissions');
          control.setActiveWiki(null);
          control.setViewedProfileId(null);
          if (onboard) onboard.setIsOpen(false);
        }
      },
      {
        id: 'admin_dashboard',
        name: '09_Admin_Moderation_Dashboard_Panel_View',
        label: 'Main Administrative Moderation dashboard',
        action: async () => {
          control.setActiveTab('moderation');
          control.setActiveWiki(null);
          control.setViewedProfileId(null);
          setActiveTab('proposals');
          if (onboard) onboard.setIsOpen(false);
        }
      },
      {
        id: 'onboarding_step0',
        name: '10_Onboarding_Introduction_Modal_Step1',
        label: 'Welcome onboarding Intro Overlay',
        action: async () => {
          control.setActiveWiki(null);
          if (onboard) {
            onboard.setIsOpen(true);
            onboard.setStep(0);
          }
        }
      },
      {
        id: 'onboarding_step1',
        name: '11_Onboarding_The_Arena_Modal_Step2',
        label: 'Welcome Onboarding Arena Overlay',
        action: async () => {
          control.setActiveWiki(null);
          if (onboard) {
            onboard.setIsOpen(true);
            onboard.setStep(1);
          }
        }
      },
      {
        id: 'login_modal',
        name: '12_User_Authentication_Login_Modal',
        label: 'User Verification / Authentication Modal',
        action: async () => {
          control.setActiveTab('leaderboard');
          control.setIsLoginModalOpen(true);
          if (onboard) onboard.setIsOpen(false);
        }
      },
      {
        id: 'user_profile_tab',
        name: '13_User_Profile_Dashboard_View',
        label: 'User Personal Profile Settings Dashboard',
        action: async () => {
          control.setActiveTab('profile');
          control.setViewedProfileId(null);
          if (onboard) onboard.setIsOpen(false);
        }
      },
      {
        id: 'profile_overlay',
        name: '14_Community_User_Profile_Overlay',
        label: 'Community User Profile Overlay Modal Popup',
        action: async () => {
          control.setActiveTab('leaderboard');
          control.setViewedProfileId('sample_user_preview_123');
          if (onboard) onboard.setIsOpen(false);
        }
      },
      {
        id: 'tourney_builder',
        name: '15_Tournament_Creator_Builder_View',
        label: 'Custom Tournament Creator Form',
        action: async () => {
          control.setActiveTab('tourney-builder');
          if (onboard) onboard.setIsOpen(false);
        }
      },
      {
        id: 'track_preview',
        name: '16_Track_Leaderboard_Single_Item_Preview',
        label: 'Track Quick Preview Card',
        action: async () => {
          control.setActiveTab('leaderboard');
          if (onboard) onboard.setIsOpen(false);
        }
      },
      {
        id: 'clash_panel',
        name: '17_Clash_Of_The_Day_Panel',
        label: 'Clash of the Day Side Widget',
        action: async () => {
          control.setActiveTab('leaderboard');
          if (onboard) onboard.setIsOpen(false);
        }
      },
      {
        id: 'playlists_tab',
        name: '18_Playlists_Discovery_Tab',
        label: 'User Playlists Discovery Hub',
        action: async () => {
          control.setActiveTab('leaderboard');
          if (control.tracks && control.tracks.length > 0) {
            // Can't directly access inner states of leaderboard, but setting the tab to leaderboard is fine.
          }
          if (onboard) onboard.setIsOpen(false);
        }
      },
      {
        id: 'search_filters',
        name: '19_Mobile_Search_Filters_Expanded',
        label: 'Database Tag / Sort filters open',
        action: async () => {
          control.setActiveTab('detailed_search');
          if (onboard) onboard.setIsOpen(false);
        }
      }
    ];

    const activeSteps = allSteps.filter(s => selectedCombinations.includes(s.id));
    if (activeSteps.length === 0) {
      toast.dismiss("lab-loader");
      toast.error("Please choose at least one environment combination state.");
      setIsCapturing(false);
      return;
    }

    const tempCaptured: any[] = [];

    for (let i = 0; i < activeSteps.length; i++) {
      const stepObj = activeSteps[i];
      setCurrentCaptureIndex(i);

      const stepLog = `[CYCLE ${i+1}/${activeSteps.length}] Configuring State: '${stepObj.label}'...`;
      logsList.push(stepLog);
      setLabLogs([...logsList]);
      toast.loading(`Capturing state ${i+1}/${activeSteps.length}: ${stepObj.label}...`, { id: "lab-loader" });

      await stepObj.action();

      const delayVal = Math.max(100, screenshotDelay);
      logsList.push(`[RENDER] Waiting ${delayVal}ms for layout transitions...`);
      setLabLogs([...logsList]);
      await new Promise(resolve => setTimeout(resolve, delayVal));

      logsList.push(`[IMAGE_CAPTURE] Running screenshots of root panel...`);
      setLabLogs([...logsList]);

      const dataUrl = await captureScreenshot(stepObj.name, (stepObj as any).selector || 'body');
      if (dataUrl) {
        tempCaptured.push({
          id: stepObj.id,
          name: stepObj.name,
          dataUrl
        });
        logsList.push(`[SUCCESS] Generated PNG image block '${stepObj.name}' (${Math.round(dataUrl.length / 1024)}KB)`);
      } else {
        logsList.push(`[FAIL] Camera capture failed for state: ${stepObj.label}`);
      }
      setLabLogs([...logsList]);
    }

    // Restore back
    logsList.push(`[RESTORE] Restoring workspace default state...`);
    setLabLogs([...logsList]);

    setActiveTab('ui-lab');
    if (onboard) {
      onboard.setIsOpen(false);
    }

    control.setActiveTab(restoredState.activeTab);
    control.setActiveWiki(restoredState.activeWiki);
    control.setGlobalPlayingTrack(restoredState.globalPlayingTrack);
    control.setIsLoginModalOpen(restoredState.isLoginModalOpen);
    control.setViewedProfileId(restoredState.viewedProfileId);

    setCapturedImages(tempCaptured);
    logsList.push(`[COMPLETE] Run complete! Successfully saved ${tempCaptured.length} of ${activeSteps.length} target snapshots.`);
    setLabLogs([...logsList]);

    toast.dismiss("lab-loader");
    toast.success(`Generated ${tempCaptured.length} screenshots successfully! See previews below.`);
    setIsCapturing(false);
    setCurrentCaptureIndex(-1);
  };

  const downloadSingleCapturedImage = (item: { name: string; dataUrl: string }) => {
    const link = document.createElement('a');
    link.href = item.dataUrl;
    link.download = `${item.name}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`Downloaded '${item.name}.png'!`);
  };

  const downloadAllCapturedImages = async () => {
    if (capturedImages.length === 0) {
      toast.error("No captured screenshots available to download.");
      return;
    }
    toast.loading("Triggering batch file transfers...", { id: "download-loader" });
    for (let i = 0; i < capturedImages.length; i++) {
      const item = capturedImages[i];
      downloadSingleCapturedImage(item);
      await new Promise(resolve => setTimeout(resolve, 350));
    }
    toast.dismiss("download-loader");
    toast.success("All requested captures successfully downloaded.");
  };

  // Smart Album Art / Cover Resolver States
  const [isProcessingImages, setIsProcessingImages] = useState(false);
  const [imagesProgress, setImagesProgress] = useState(0);
  const [imagesTotal, setImagesTotal] = useState(0);

  // Sandbox Import Wizard States
  const [sandboxAnimeQuery, setSandboxAnimeQuery] = useState('');
  const [isSandboxSearchingMAL, setIsSandboxSearchingMAL] = useState(false);
  const [sandboxMalResults, setSandboxMalResults] = useState<any[]>([]);
  const [isSandboxDiscoveringOSTs, setIsSandboxDiscoveringOSTs] = useState(false);
  const [sandboxOstResults, setSandboxOstResults] = useState<any[]>([]);
  const [selectedSandboxOsts, setSelectedSandboxOsts] = useState<Set<number>>(new Set());
  const [selectedSandboxMalItem, setSelectedSandboxMalItem] = useState<any | null>(null);
  const [isSweepingDuplicates, setIsSweepingDuplicates] = useState(false);

  // Semi-Auto Campaign Wizard States
  const [campaignQueue, setCampaignQueue] = useState<string[]>([]);
  const [currentCampaignIndex, setCurrentCampaignIndex] = useState<number>(-1);

  const campaignStats = useMemo(() => {
    const nameMap = new Map<string, { total: number; osts: number }>();
    tracks.forEach(t => {
      const name = (t.animeName || "").trim();
      if (!name) return;
      const stats = nameMap.get(name) || { total: 0, osts: 0 };
      stats.total += 1;
      if (t.type === 'OST') {
        stats.osts += 1;
      }
      nameMap.set(name, stats);
    });
    
    let totalSeries = nameMap.size;
    let missingOstSeriesCount = 0;
    nameMap.forEach((stats) => {
      if (stats.osts === 0) {
        missingOstSeriesCount += 1;
      }
    });
    
    return {
      totalSeries,
      missingOstSeriesCount
    };
  }, [tracks]);

  const triggerCampaignItem = async (animeName: string) => {
    // 1. Sync active search text
    setSandboxAnimeQuery(animeName);
    
    // 2. Perform MAL search
    setIsSandboxSearchingMAL(true);
    setSandboxMalResults([]);
    setSelectedSandboxMalItem(null);
    setSandboxOstResults([]);
    
    try {
      const res = await apiFetch(`/api/anime-search?q=${encodeURIComponent(animeName)}`);
      if (res.ok) {
        const data = await res.json();
        const results = data.data || [];
        setSandboxMalResults(results);
        
        if (results.length > 0) {
          // Select topmost match immediately (no manual research lookup!)
          const bestMatch = results[0];
          await new Promise(r => setTimeout(r, 450));
          await handleSelectSandboxMAL(bestMatch);
        } else {
          toast.error(`No MAL franchise found matching "${animeName}". Try skipping or manual entry.`);
        }
      } else {
        toast.error(`Error querying MAL series database for "${animeName}".`);
      }
    } catch (e) {
      console.error(e);
      toast.error(`Search exception on campaign item "${animeName}".`);
    } finally {
      setIsSandboxSearchingMAL(false);
    }
  };

  const initializeCampaign = (filterType: "all" | "no-osts") => {
    const nameMap = new Map<string, { total: number; osts: number }>();
    tracks.forEach(t => {
      const name = (t.animeName || "").trim();
      if (!name) return;
      const stats = nameMap.get(name) || { total: 0, osts: 0 };
      stats.total += 1;
      if (t.type === 'OST') {
        stats.osts += 1;
      }
      nameMap.set(name, stats);
    });

    const list: string[] = [];
    nameMap.forEach((stats, name) => {
      if (filterType === "all") {
        list.push(name);
      } else if (filterType === "no-osts" && stats.osts === 0) {
        list.push(name);
      }
    });

    list.sort();
    setCampaignQueue(list);
    if (list.length === 0) {
      toast.info("No anime series discovered fitting that Campaign criteria.");
      setCurrentCampaignIndex(-1);
    } else {
      setCurrentCampaignIndex(0);
      toast.success(`Loaded campaign queue with ${list.length} anime series! Starting...`);
      triggerCampaignItem(list[0]);
    }
  };

  const advanceCampaign = () => {
    if (currentCampaignIndex === -1) return;
    const nextIdx = currentCampaignIndex + 1;
    if (nextIdx < campaignQueue.length) {
      setCurrentCampaignIndex(nextIdx);
      toast.info(`Advancing auto-campaign to target series: "${campaignQueue[nextIdx]}"`);
      triggerCampaignItem(campaignQueue[nextIdx]);
    } else {
      setCurrentCampaignIndex(-1);
      setCampaignQueue([]);
      toast.success("🤖 Soundtrack Campaign finished! Catalog is fully enriched!");
    }
  };

  // YouTube Playlist / Search States
  const [sandboxYoutubeQuery, setSandboxYoutubeQuery] = useState('');
  const [isSandboxSearchingYoutube, setIsSandboxSearchingYoutube] = useState(false);
  const [sandboxYoutubeResults, setSandboxYoutubeResults] = useState<any[]>([]);
  const [sandboxYoutubePlaylists, setSandboxYoutubePlaylists] = useState<any[]>([]);
  const [selectedPlaylists, setSelectedPlaylists] = useState<Set<string>>(new Set());
  const [selectedSandboxYoutube, setSelectedSandboxYoutube] = useState<Set<number>>(new Set());
  const [isFetchingPlaylist, setIsFetchingPlaylist] = useState(false);

  // Sandbox manual form
  const [manualTitle, setManualTitle] = useState('');
  const [manualArtist, setManualArtist] = useState('');
  const [manualAnimeName, setManualAnimeName] = useState('');
  const [manualAnimePart, setManualAnimePart] = useState('');
  const [manualYtId, setManualYtId] = useState('');
  const [manualType, setManualType] = useState<TrackType>('OP');
  const [manualCover, setManualCover] = useState('');
  const [manualTagsText, setManualTagsText] = useState('');
  const [isInsertingManual, setIsInsertingManual] = useState(false);

  // Database Diagnostic Indices & Grade
  const stats = useMemo(() => {
    const total = tracks.length || 1;
    const coversCount = tracks.filter(t => t.customImageUrl && t.customImageUrl.trim() !== "" && !t.customImageUrl.includes("ytimg") && !t.customImageUrl.includes("youtube")).length;
    const malAlignedCount = tracks.filter(t => t.animePart && t.animePart.trim() !== "").length;
    const taggedCount = tracks.filter(t => t.tags && t.tags.length > 0).length;
    const UserAddedCount = tracks.filter(t => t.addedByUser).length;

    const coverRate = (coversCount / total) * 100;
    const alignmentRate = (malAlignedCount / total) * 100;
    const tagRate = (taggedCount / total) * 100;

    // Weight Grade Calculation out of 100
    // 35% covers, 35% alignment, 30% tags
    const score = (coverRate * 0.35) + (alignmentRate * 0.35) + (tagRate * 0.30);
    
    let grade = 'F';
    let gradeColor = 'text-vermillion-hover';
    if (score >= 95) { grade = 'S'; gradeColor = 'text-vermillion font-extrabold'; }
    else if (score >= 90) { grade = 'A+'; gradeColor = 'text-gold-bright font-extrabold'; }
    else if (score >= 80) { grade = 'A'; gradeColor = 'text-gold font-bold'; }
    else if (score >= 70) { grade = 'B'; gradeColor = 'text-moss font-bold'; }
    else if (score >= 60) { grade = 'C'; gradeColor = 'text-burnt'; }
    else if (score >= 40) { grade = 'D'; gradeColor = 'text-text-muted'; }

    return {
      total: tracks.length,
      coverRate: Math.round(coverRate),
      alignmentRate: Math.round(alignmentRate),
      tagRate: Math.round(tagRate),
      userAdded: UserAddedCount,
      score: Math.round(score),
      grade,
      gradeColor
    };
  }, [tracks]);

  // Handle single proposal resolution
  const handleResolveProposal = async (proposal: ContributionProposal) => {
    setIsResolvingId(proposal.id);
    try {
      const resp = await apiFetch('/api/resolve-single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: proposal.trackData.title,
          artist: proposal.trackData.artist,
          animeName: proposal.trackData.animeName,
          type: proposal.trackData.type,
          existingYtIds: tracks.map(t => t.youtubeId)
        })
      });

      if (resp.ok) {
        const data = await resp.json();
        if (data.youtubeId && proposal.oldTrackId) {
          onUpdateTrackYtId(proposal.oldTrackId, data.youtubeId);
          onApproveProposal(proposal.id);
          toast.success(`Successfully resolved and updated "${proposal.trackData.title}" to clean link!`);
        } else {
          toast.error("Found no suitable replacement on YouTube. Please resolve manually.");
        }
      } else {
        toast.error("VGMdb automatic video mapping failed.");
      }
    } catch (e) {
      toast.error("Error resolving replacement link.");
    } finally {
      setIsResolvingId(null);
    }
  };

  // Automated Pipelines
  const startAnimeMalAlignmentBatch = async () => {
    if (!onUpdateTrackAnimeName) {
      toast.error("onUpdateTrackAnimeName prop is missing from application root.");
      return;
    }

    setIsAligningMAL(true);
    setAlignProgress(0);
    setBatchLogs(prev => [...prev, `[INIT] AI MyAnimeList Alignment Sweep initialized...`]);

    const unalignedTracks = tracks.filter(t => !t.animePart);
    const uniqueAnimes = Array.from(new Set(unalignedTracks.map(t => t.animeName))).filter(Boolean);
    setAlignTotal(uniqueAnimes.length);
    setBatchLogs(prev => [...prev, `[PROCESS] Found ${uniqueAnimes.length} unique series requiring MAL structure.`]);

    if (uniqueAnimes.length === 0) {
      setBatchLogs(prev => [...prev, `[COMPLETE] All database tracks are fully aligned and indexed!`]);
      setIsAligningMAL(false);
      return;
    }

    const tasks: any[] = [];
    let modifiedCount = 0;

    const concurrentLimit = 3;
    for (let i = 0; i < uniqueAnimes.length; i += concurrentLimit) {
      const chunk = uniqueAnimes.slice(i, i + concurrentLimit);
      setAlignProgress(Math.min(i + concurrentLimit, uniqueAnimes.length));
      setBatchLogs(prev => [...prev, `[JIKAN] (${Math.min(i + concurrentLimit, uniqueAnimes.length)}/${uniqueAnimes.length}) Fetching: ${chunk.map(c => `"${c}"`).join(', ')}...`]);

      const chunkPromises = chunk.map(async (origAnimeName) => {
        try {
          const searchResp = await apiFetch(`/api/anime-search?q=${encodeURIComponent(origAnimeName)}`);
          if (!searchResp.ok) {
            throw new Error(`Status ${searchResp.status}`);
          }
          const searchData = await searchResp.json();
          const malCandidates = searchData.data || [];

          if (malCandidates.length > 0) {
            const associatedTracks = unalignedTracks.filter(t => t.animeName === origAnimeName);
            return {
              originalAnimeName: origAnimeName,
              tracks: associatedTracks.map(t => ({ id: t.id, title: t.title, artist: t.artist })),
              malCandidates: malCandidates.slice(0, 10)
            };
          }
        } catch (err: any) {
          setBatchLogs(prev => [...prev, `[ERROR] Jikan lookup failed for "${origAnimeName}": ${err.message}`]);
        }
        return null;
      });

      const results = await Promise.all(chunkPromises);
      for (const res of results) {
        if (res) tasks.push(res);
      }

      if (i + concurrentLimit < uniqueAnimes.length) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    setBatchLogs(prev => [...prev, `[ALIGNING] Candidates fetched for ${tasks.length} series. Initiating Gemini matchmaking...`]);

    const geminiBatchLimit = 2;
    const geminiChunkSize = 10;
    const geminiChunks: any[][] = [];
    
    for (let i = 0; i < tasks.length; i += geminiChunkSize) {
      geminiChunks.push(tasks.slice(i, i + geminiChunkSize));
    }

    for (let i = 0; i < geminiChunks.length; i += geminiBatchLimit) {
      const chunksToProcess = geminiChunks.slice(i, i + geminiBatchLimit);
      setBatchLogs(prev => [...prev, `[GEMINI] Processing alignment batches ${Math.floor(i / geminiBatchLimit) * geminiBatchLimit + 1} to ${Math.floor(i / geminiBatchLimit) * geminiBatchLimit + chunksToProcess.length}...`]);

      const batchPromises = chunksToProcess.map(async (chunk, chunkIdx) => {
        try {
          const alignResp = await apiFetch('/api/align-batch-anime', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ batch: chunk })
          });

          if (alignResp.ok) {
            const alignData = await alignResp.json();
            const alignments = alignData.alignments || [];
            let chunkModified = 0;

            for (const alignment of alignments) {
              const { trackId, masterFranchiseName, alignedPart } = alignment;
              if (masterFranchiseName && alignedPart && onUpdateTrackAnimeName) {
                const cleanMasterName = getMainAnimeName(masterFranchiseName);
                await onUpdateTrackAnimeName(trackId, cleanMasterName, alignedPart);
                chunkModified++;
              }
            }
            return chunkModified;
          } else {
            setBatchLogs(prev => [...prev, `[ERROR] AI Alignment segment #${i + chunkIdx + 1} server error: ${alignResp.status}`]);
          }
        } catch (err: any) {
          setBatchLogs(prev => [...prev, `[ERROR] AI Segment conversion #${i + chunkIdx + 1} failure: ${err.message}`]);
        }
        return 0;
      });

      const chunkCounts = await Promise.all(batchPromises);
      for (const count of chunkCounts) {
        modifiedCount += count;
      }

      setBatchLogs(prev => [...prev, `[SUCCESS] Processed batch set. Database synchronized.`]);

      if (i + geminiBatchLimit < geminiChunks.length) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    setBatchLogs(prev => [...prev, `[COMPLETE] Finished sweep. Aligned ${modifiedCount} local themes to canonical franchises.`]);
    setIsAligningMAL(false);
    toast.success(`Successfully mapped ${modifiedCount} tracks to MyAnimeList standards!`);
  };

  const startSmartImageBatch = async (overwrite: boolean = false) => {
    setIsProcessingImages(true);
    setImagesProgress(0);
    setBatchLogs(prev => [...prev, `[INIT] Smart Artwork Crawler initialized (${overwrite ? 'OVERWRITE' : 'FILL GAPS'})...`]);

    const targets = overwrite 
      ? tracks 
      : tracks.filter(t => !t.customImageUrl || t.customImageUrl.trim() === "" || t.customImageUrl.includes("youtube.com") || t.customImageUrl.includes("ytimg.com"));
    
    setImagesTotal(targets.length);

    if (targets.length === 0) {
      setBatchLogs(prev => [...prev, `[COMPLETE] No tracks require cover mapping under selected criteria.`]);
      setIsProcessingImages(false);
      return;
    }

    setBatchLogs(prev => [...prev, `[PROCESS] Processing album art resolution for ${targets.length} themes...`]);

    const chunkSize = 5;
    for (let i = 0; i < targets.length; i += chunkSize) {
      const chunk = targets.slice(i, i + chunkSize);
      
      try {
        const resp = await apiFetch('/api/resolve-track-images-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tracks: chunk, overwrite })
        });

        if (resp.ok) {
          const { resolvedImages } = await resp.json();
          let count = 0;

          await Promise.all(
            Object.entries(resolvedImages || {}).map(async ([trackId, imgUrl]) => {
              if (imgUrl) {
                await updateTrackImageUrlInDb(trackId, imgUrl as string);
                count++;
                const tm = chunk.find(c => c.id === trackId);
                setBatchLogs(prev => [...prev, `[SUCCESS] Linked "${tm?.title}" to cover art: ${imgUrl}`]);
              }
            })
          );
          setBatchLogs(prev => [...prev, `[BATCH] Processed segment ${Math.floor(i / chunkSize) + 1} of ${Math.ceil(targets.length / chunkSize)}.`]);
        }
      } catch (err: any) {
        setBatchLogs(prev => [...prev, `[ERROR] Image crawler fault: ${err.message}`]);
      }

      setImagesProgress(Math.min(targets.length, i + chunk.length));
      await new Promise(r => setTimeout(r, 500));
    }

    setBatchLogs(prev => [...prev, `[COMPLETE] Beautiful premium custom artwork mapping finalized.`]);
    setIsProcessingImages(false);
    toast.success("Cover art generation pass completed!");
  };

  const startAutoTagBatch = async (onlyUntagged: boolean) => {
    setIsTagging(true);
    setTaggingProgress(0);
    setBatchLogs(prev => [...prev, `[INIT] Advanced Gemini Auto-Tagger starting...`]);

    const targets = onlyUntagged 
      ? tracks.filter(t => !t.tags || t.tags.length === 0)
      : tracks;

    setTaggingTotal(targets.length);
    if (targets.length === 0) {
      setBatchLogs(prev => [...prev, `[COMPLETE] No tracks require tagging under criteria.`]);
      setIsTagging(false);
      return;
    }

    setBatchLogs(prev => [...prev, `[PROCESS] Categorizing ${targets.length} styles and vibes...`]);

    for (let i = 0; i < targets.length; i++) {
      const track = targets[i];
      setTaggingProgress(i + 1);

      try {
        const resp = await apiFetch('/api/auto-tag', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: track.title,
            artist: track.artist || 'Unknown',
            animeName: track.animeName,
            type: track.type
          })
        });

        if (resp.ok) {
          const data = await resp.json();
          if (data.tags && Array.isArray(data.tags)) {
            await updateTrackTagsInDb(track.id, data.tags);
            setBatchLogs(prev => [...prev, `[SUCCESS] Styled "${track.title}" with descriptors: [${data.tags.join(', ')}]`]);
          }
        }
      } catch (err) {
        setBatchLogs(prev => [...prev, `[ERROR] Tag generation failure on "${track.title}"`]);
      }
      await new Promise(r => setTimeout(r, 650));
    }

    setBatchLogs(prev => [...prev, `[COMPLETE] Style/vibe meta indexing operation processed successfully.`]);
    setIsTagging(false);
    toast.success("Database tracks classified with metadata descriptors!");
  };

  const startBatchVerification = async () => {
    setIsBatchResolving(true);
    setBatchProgress(0);
    setBatchTotal(tracks.length);
    setBatchLogs(["Initiating stream health diagnostics check..."]);

    const batchSize = 25;
    const allExistingIds = tracks.map(t => t.youtubeId).filter(Boolean);

    for (let i = 0; i < tracks.length; i += batchSize) {
      const chunk = tracks.slice(i, i + batchSize);
      const chunkIds = chunk.map(t => t.youtubeId).filter(Boolean);
      
      setBatchLogs(prev => [...prev, `[Sweeper] Auditing video integrity for tracks ${i + 1} to ${Math.min(tracks.length, i + batchSize)}...`]);

      try {
        const verifyRes = await apiFetch('/api/verify-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: chunkIds })
        });

        if (!verifyRes.ok) throw new Error("Verification API unavailable.");

        const { results } = await verifyRes.json();
        const deadTracksInChunk: AnimeTrack[] = [];

        chunk.forEach(track => {
          const isAlive = results && results[track.youtubeId] !== undefined ? results[track.youtubeId] : false;
          if (isAlive) {
            setBatchLogs(prev => [...prev, `[OK] "${track.title}" link check pass.`]);
          } else {
            setBatchLogs(prev => [...prev, `[FAIL] DEAD STREAM DETECTED: "${track.title}" (ID: ${track.youtubeId})`]);
            deadTracksInChunk.push(track);
          }
        });

        if (deadTracksInChunk.length > 0) {
          setBatchLogs(prev => [...prev, `[REPAIR] Triggering batch auto-repair lookup for ${deadTracksInChunk.length} offline themes...`]);
          
          const resolveRes = await apiFetch('/api/resolve-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tracks: deadTracksInChunk.map(t => ({
                id: t.id,
                title: t.title,
                artist: t.artist,
                animeName: t.animeName,
                type: t.type
              })),
              existingYtIds: allExistingIds
            })
          });

          if (resolveRes.ok) {
            const { resolved } = await resolveRes.json();
            Object.keys(resolved || {}).forEach(trackId => {
              const newYtId = resolved[trackId];
              const t = deadTracksInChunk.find(dt => dt.id === trackId);
              if (t && newYtId) {
                onUpdateTrackYtId(trackId, newYtId);
                setBatchLogs(prev => [...prev, `[RECOVERY] Rerouted "${t.title}" to clean stream ID: ${newYtId}`]);
              }
            });
          }
        }
      } catch (err: any) {
        setBatchLogs(prev => [...prev, `[ERROR] Verification packet failure: ${err.message}`]);
      }

      setBatchProgress(Math.min(tracks.length, i + batchSize));
      await new Promise(r => setTimeout(r, 150));
    }

    setBatchLogs(prev => [...prev, "[COMPLETE] stream health audit completed. Database online and verified."]);
    setIsBatchResolving(false);
  };

  // Track database selection editor modal
  const handleOpenEditor = (track: AnimeTrack) => {
    setEditingTrack(track);
    setEditorTitle(track.title);
    setEditorArtist(track.artist || '');
    setEditorAnime(track.animeName || '');
    setEditorPart(track.animePart || '');
    setEditorYtoolsId(track.youtubeId || '');
    setEditorCover(track.customImageUrl || '');
    setEditorTags(track.tags || []);
    setEditorType(track.type || 'OP');
  };

  const handleSaveTrackEdits = async () => {
    if (!editingTrack) return;
    setIsSavingTrack(true);
    try {
      if (editorTitle !== editingTrack.title || editorArtist !== editingTrack.artist) {
        // Since we don't have updateTitleInDb, we can write direct to db or update existing track items using updateDoc
        const { doc, updateDoc } = await import('firebase/firestore');
        const { db } = await import('../utils/firebase');
        await updateDoc(doc(db, 'tracks', editingTrack.id), { 
          title: editorTitle, 
          artist: editorArtist,
          type: editorType
        });
      }

      if (editorAnime !== editingTrack.animeName || editorPart !== editingTrack.animePart) {
        if (onUpdateTrackAnimeName) {
          await onUpdateTrackAnimeName(editingTrack.id, editorAnime, editorPart);
        }
      }

      if (editorYtoolsId !== editingTrack.youtubeId) {
        onUpdateTrackYtId(editingTrack.id, editorYtoolsId);
      }

      if (editorCover !== editingTrack.customImageUrl) {
        await updateTrackImageUrlInDb(editingTrack.id, editorCover);
      }

      // Check arrays equal
      if (JSON.stringify(editorTags) !== JSON.stringify(editingTrack.tags || [])) {
        await updateTrackTagsInDb(editingTrack.id, editorTags);
      }

      toast.success(`Track "${editorTitle}" successfully updated!`);
      setEditingTrack(null);
    } catch (e: any) {
      toast.error(`Update failed: ${e.message}`);
    } finally {
      setIsSavingTrack(false);
    }
  };

  const handleDeleteSingleTrack = async (trackId: string, trackTitle: string) => {
    if (await confirm({ title: `Permanently delete "${trackTitle}"?`, body: 'This removes the track from the database. The action cannot be undone.', confirmLabel: 'Delete', danger: true })) {
      try {
        await deleteTrackFromDb(trackId);
        toast.success(`"${trackTitle}" deleted from database.`);
        if (editingTrack?.id === trackId) setEditingTrack(null);
      } catch (e: any) {
        toast.error(`Deletion failed: ${e.message}`);
      }
    }
  };

  const handleSuggestCoverDetails = async () => {
    setIsSuggestingCover(true);
    try {
      const resp = await apiFetch('/api/resolve-track-images-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks: [{ id: editingTrack?.id, title: editorTitle, artist: editorArtist, animeName: editorAnime, type: editorType }], overwrite: true })
      });
      if (resp.ok) {
        const { resolvedImages } = await resp.json();
        const url = resolvedImages[editingTrack?.id || ''];
        if (url) {
          setEditorCover(url);
          toast.success("Cover artwork suggested!");
        } else {
          toast.info("No cover image discovered for this exact combination.");
        }
      }
    } catch (e) {
      toast.error("Error pulling cover suggestion.");
    } finally {
      setIsSuggestingCover(false);
    }
  };

  // Sandbox Import Wizard Actions
  const handleSearchSandboxMAL = async () => {
    if (!sandboxAnimeQuery.trim()) return;
    setIsSandboxSearchingMAL(true);
    setSandboxMalResults([]);
    setSelectedSandboxMalItem(null);
    setSandboxOstResults([]);
    try {
      const res = await apiFetch(`/api/anime-search?q=${encodeURIComponent(sandboxAnimeQuery)}`);
      if (res.ok) {
        const data = await res.json();
        setSandboxMalResults(data.data || []);
      } else {
        toast.error("Error from Jikan series lookup.");
      }
    } catch (e) {
      toast.error("Search failed.");
    } finally {
      setIsSandboxSearchingMAL(false);
    }
  };

  const handleSelectSandboxMAL = async (item: any) => {
    setSelectedSandboxMalItem(item);
    
    // Auto-populate YouTube soundtrack query of choice
    const cleanTitle = item.title.replace(/Season \d+|Part \d+|\(.*\)|:\s*.*$/gi, '').trim();
    const trackerQuery = `${cleanTitle} soundtrack`;
    setSandboxYoutubeQuery(trackerQuery);

    // Auto-trigger smart YouTube playlist search
    setIsSandboxSearchingYoutube(true);
    setSandboxYoutubeResults([]);
    setSandboxYoutubePlaylists([]);
    setSelectedPlaylists(new Set());
    setSelectedSandboxYoutube(new Set());
    try {
      let res = await apiFetch(`/api/youtube-search?q=${encodeURIComponent(trackerQuery)}`);
      let pls = [];
      if (res.ok) {
        const data = await res.json();
        pls = data.playlists || [];
      }

      // Fallback: if no playlists are found using primary title, try the localized English title if available
      if (pls.length === 0 && item.title_english) {
        const cleanEnglishTitle = item.title_english.replace(/Season \d+|Part \d+|\(.*\)|:\s*.*$/gi, '').trim();
        if (cleanEnglishTitle.toLowerCase() !== cleanTitle.toLowerCase()) {
          const fallbackQuery = `${cleanEnglishTitle} soundtrack`;
          toast.info(`No playlists found for "${cleanTitle}". Retrying with English localized title: "${cleanEnglishTitle}"...`);
          
          const fallbackRes = await apiFetch(`/api/youtube-search?q=${encodeURIComponent(fallbackQuery)}`);
          if (fallbackRes.ok) {
            const fallbackData = await fallbackRes.json();
            const fallbackPls = fallbackData.playlists || [];
            if (fallbackPls.length > 0) {
              pls = fallbackPls;
              setSandboxYoutubeQuery(fallbackQuery);
              toast.success(`Found ${pls.length} playlists using English localized title!`);
            }
          }
        }
      }

      setSandboxYoutubePlaylists(pls);
      if (pls.length > 0) {
        setSelectedPlaylists(new Set([pls[0].listId]));
        toast.success(`Disclosed ${pls.length} YouTube soundtrack playlists. Select one!`);
      } else {
        toast.info("No soundtrack playlists found directly; try manual query.");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsSandboxSearchingYoutube(false);
    }
  };

  const handleSearchSandboxYoutube = async () => {
    if (!sandboxYoutubeQuery.trim()) return;
    setIsSandboxSearchingYoutube(true);
    setSandboxYoutubeResults([]);
    setSandboxYoutubePlaylists([]);
    setSelectedPlaylists(new Set());
    setSelectedSandboxYoutube(new Set());
    try {
      let res = await apiFetch(`/api/youtube-search?q=${encodeURIComponent(sandboxYoutubeQuery)}`);
      let pls = [];
      if (res.ok) {
        const data = await res.json();
        pls = data.playlists || [];
      }

      // Fallback for manual trigger: check if nothing found and we have chosen a MAL item with an English title
      if (pls.length === 0 && selectedSandboxMalItem?.title_english) {
        const cleanEnglishTitle = selectedSandboxMalItem.title_english.replace(/Season \d+|Part \d+|\(.*\)|:\s*.*$/gi, '').trim();
        const fallbackQuery = `${cleanEnglishTitle} soundtrack`;
        if (sandboxYoutubeQuery.trim().toLowerCase() !== fallbackQuery.toLowerCase()) {
          toast.info(`No playlists found. Retrying with English localized title: "${cleanEnglishTitle}"...`);
          const fallbackRes = await apiFetch(`/api/youtube-search?q=${encodeURIComponent(fallbackQuery)}`);
          if (fallbackRes.ok) {
            const fallbackData = await fallbackRes.json();
            const fallbackPls = fallbackData.playlists || [];
            if (fallbackPls.length > 0) {
              pls = fallbackPls;
              setSandboxYoutubeQuery(fallbackQuery);
              toast.success(`Found ${pls.length} playlists using English localized title!`);
            }
          }
        }
      }

      setSandboxYoutubePlaylists(pls);
      if (pls.length > 0) {
        setSelectedPlaylists(new Set([pls[0].listId]));
      } else {
        toast.info("No matching playlists found.");
      }
    } catch (e) {
      toast.error("YouTube Search failed.");
    } finally {
      setIsSandboxSearchingYoutube(false);
    }
  };

  const handleFetchSelectedPlaylists = async (listIds: string[]) => {
    if (listIds.length === 0) {
      toast.error("Please select at least one playlist under Step 1 first.");
      return;
    }
    setIsFetchingPlaylist(true);
    setSandboxYoutubeResults([]);
    setSelectedSandboxYoutube(new Set());
    try {
      let combinedVids: any[] = [];
      let successCount = 0;
      for (const listId of listIds) {
        const res = await apiFetch(`/api/youtube-playlist-fetch?listId=${encodeURIComponent(listId)}`);
        if (res.ok) {
          const data = await res.json();
          const vids = data.videos || [];
          combinedVids = [...combinedVids, ...vids];
          successCount++;
        }
      }
      if (successCount > 0) {
        // Deduplicate videos by videoId to keep results tidy
        const uniqueMap = new Map<string, any>();
        combinedVids.forEach(v => {
          if (v.videoId) {
            uniqueMap.set(v.videoId, v);
          }
        });
        const finalVids = Array.from(uniqueMap.values());
        setSandboxYoutubeResults(finalVids);
        
        // Auto-select non-OP/ED/TV size soundtracks
        const defaultSelected = new Set<number>();
        finalVids.forEach((v: any, i: number) => {
          if (!isOpeningOrEnding(v.title)) {
            defaultSelected.add(i);
          }
        });
        setSelectedSandboxYoutube(defaultSelected);
        toast.success(`Aggregated ${finalVids.length} tracks across ${successCount} playlists!`);
      } else {
        toast.error("Failed to extract playlists tracks from YouTube details.");
      }
    } catch (e) {
      toast.error("Aggregating playlists failed.");
    } finally {
      setIsFetchingPlaylist(false);
    }
  };

  const handleFetchPlaylist = async (listId: string) => {
    await handleFetchSelectedPlaylists([listId]);
  };

  const handleAutofillWithSandbox = (item: any, selectedTrack?: any) => {
    setManualAnimeName(item.title);
    setManualAnimePart(`Season 1 (${item.year || 'Classic'})`);
    if (item.images?.jpg?.large_image_url) {
      setManualCover(item.images.jpg.large_image_url);
    }
    if (selectedTrack) {
      setManualTitle(selectedTrack.title);
      setManualArtist(selectedTrack.artist || 'Various Artists');
      setManualType(selectedTrack.type || 'OST');
      if (selectedTrack.youtubeId) {
        setManualYtId(selectedTrack.youtubeId);
      }
      setManualTagsText((selectedTrack.tags || []).concat(['Official', 'Theme']).join(', '));
    }
    toast.success("Autofilled sandbox manual form below!");
  };

  const handleInsertManual = async () => {
    if (!manualTitle.trim() || !manualAnimeName.trim()) {
      toast.error("Title and Anime Name are required to index!");
      return;
    }
    setIsInsertingManual(true);
    try {
      const trackId = `manual_${Math.random().toString(36).substring(2, 11)}`;
      const newTrack: AnimeTrack = {
        id: trackId,
        title: manualTitle.trim(),
        artist: manualArtist.trim() || 'Unknown',
        animeName: getMainAnimeName(manualAnimeName.trim()),
        animePart: manualAnimePart.trim() || undefined,
        type: manualType,
        youtubeId: manualYtId.trim(),
        elo: 1200,
        matchesPlayed: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        addedByUser: true,
        tags: manualTagsText ? manualTagsText.split(',').map(t => t.trim()).filter(Boolean) : [],
        customImageUrl: manualCover.trim() || undefined
      };

      await addTrackToDb(newTrack);
      toast.success(`Track "${manualTitle}" successfully integrated into the Active database!`);
      // Reset manual form
      setManualTitle('');
      setManualArtist('');
      setManualYtId('');
      setManualTagsText('');
    } catch (e: any) {
      toast.error(`Failed insertion: ${e.message}`);
    } finally {
      setIsInsertingManual(false);
    }
  };

  // Proposals processing
  const filteredProposals = proposals.filter(p => {
    if (proposalFilter === 'all') return true;
    return p.status === proposalFilter;
  });

  const handleStartReject = (id: string) => {
    setActiveRejectingId(id);
    if (!rejectionNotes[id]) {
      setRejectionNotes(prev => ({ ...prev, [id]: '' }));
    }
  };

  const handleConfirmReject = (id: string) => {
    const reason = rejectionNotes[id]?.trim() || 'Duplicate entry, incorrect track type or dead link.';
    onRejectProposal(id, reason);
    setActiveRejectingId(null);
  };

  // Catalog filtered items in memory
  const processedCatalogTracks = useMemo(() => {
    let list = [...tracks];

    // Search filter
    if (catalogSearch.trim()) {
      const q = catalogSearch.toLowerCase().trim();
      list = list.filter(t => 
        t.title.toLowerCase().includes(q) || 
        (t.artist || '').toLowerCase().includes(q) || 
        t.animeName.toLowerCase().includes(q)
      );
    }

    // Type filter
    if (catalogTypeFilter !== 'ALL') {
      list = list.filter(t => t.type === catalogTypeFilter);
    }

    // Coverage anomalies filters
    if (catalogCoverageFilter === 'MISSING_COVER') {
      list = list.filter(t => !t.customImageUrl || t.customImageUrl.trim() === "" || t.customImageUrl.includes("ytimg") || t.customImageUrl.includes("youtube"));
    } else if (catalogCoverageFilter === 'MISSING_TAGS') {
      list = list.filter(t => !t.tags || t.tags.length === 0);
    } else if (catalogCoverageFilter === 'MISSING_MAL_PART') {
      list = list.filter(t => !t.animePart);
    } else if (catalogCoverageFilter === 'HIGH_ELO') {
      list = list.filter(t => t.elo >= 1300);
    }

    // Sort by ELO desc by default
    list.sort((a, b) => b.elo - a.elo);

    return list;
  }, [tracks, catalogSearch, catalogTypeFilter, catalogCoverageFilter]);

  // Pagination bounds
  const catalogTotalPages = Math.ceil(processedCatalogTracks.length / itemsPerPage) || 1;
  const paginatedCatalogTracks = useMemo(() => {
    const startIdx = (catalogPage - 1) * itemsPerPage;
    return processedCatalogTracks.slice(startIdx, startIdx + itemsPerPage);
  }, [processedCatalogTracks, catalogPage]);

  return (
    <div className="space-y-6">
      
      {/* Visual Moderation Dashboard — visual tools for fast decisions */}
      <ModerationDashboard
        proposals={proposals}
        tracks={tracks}
        onApproveProposal={(p, trackData) => {
          // Create the track in Firestore, then approve the proposal
          if (trackData.youtubeId && trackData.title) {
            const newTrack: AnimeTrack = {
              id: generateId('track'),
              title: trackData.title,
              artist: trackData.artist || 'Unknown',
              animeName: trackData.animeName || '',
              type: trackData.type || 'OP',
              youtubeId: trackData.youtubeId,
              elo: 1200,
              matchesPlayed: 0,
              wins: 0,
              losses: 0,
              draws: 0,
              addedByUser: false,
              tags: trackData.tags,
              customImageUrl: trackData.customImageUrl,
            };
            if (onBulkAddTracks) {
              onBulkAddTracks([newTrack]).then(() => {
                onApproveProposal(p.id);
                toast.success('Track added via moderation dashboard!');
              }).catch(err => toast.error('Failed to add: ' + err.message));
            }
          }
        }}
        onRejectProposal={(p) => {
          onRejectProposal(p.id, 'Rejected via moderation dashboard');
        }}
        onUpdateTrack={(trackId, updates) => {
          if (updates.youtubeId) {
            onUpdateTrackYtId(trackId, updates.youtubeId);
          }
          if (updates.tags) {
            updateTrackTagsInDb(trackId, updates.tags).then(() => {
              toast.success('Tags updated!');
            }).catch(err => toast.error('Tag update failed: ' + err.message));
          }
          if (updates.customImageUrl) {
            updateTrackImageUrlInDb(trackId, updates.customImageUrl).then(() => {
              toast.success('Cover art updated!');
            }).catch(err => toast.error('Cover update failed: ' + err.message));
          }
          // Artist Lookup tool writes `artist` directly via updateTrackInDb.
          // We don't surface a toast here because the tool's applyOne /
          // applyAll handlers show their own toasts — this avoids double
          // notifications on bulk apply.
          if (updates.artist) {
            updateTrackInDb(trackId, { artist: updates.artist }).catch(err =>
              toast.error('Artist update failed: ' + err.message),
            );
          }
        }}
        onBulkAddTracks={onBulkAddTracks}
      />

      {/* Dynamic SRE Dashboard & Diagnostic KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Total Database Health Grade Card */}
        <div className="bg-[#111215] border border-zinc-900/60 rounded-xl p-4 flex flex-col justify-between relative overflow-hidden backdrop-blur-md">
          <div className="absolute top-0 right-0 h-12 w-12 bg-vermillion/5 rounded-full blur-xl" />
          <div className="flex justify-between items-start">
            <span className="text-[11px] uppercase font-mono tracking-wider text-zinc-400 flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-vermillion" /> Database Integrity
            </span>
            <span className={`text-2xl font-black ${stats.gradeColor}`}>{stats.grade}</span>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-black text-white">{stats.total}</div>
            <p className="text-[11px] font-mono text-zinc-500 mt-1 uppercase">// {stats.score}% METADATA COHERENCE</p>
          </div>
        </div>

        {/* Custom Covers Rate Card */}
        <div className="bg-[#111215] border border-zinc-900/60 rounded-xl p-4 flex flex-col justify-between relative overflow-hidden backdrop-blur-md">
          <div className="absolute top-0 right-0 h-12 w-12 bg-gold/5 rounded-full blur-xl" />
          <div className="flex justify-between items-start">
            <span className="text-[11px] uppercase font-mono tracking-wider text-zinc-400 flex items-center gap-1.5">
              <ImageIcon className="w-3.5 h-3.5 text-gold" /> Cover Artwork
            </span>
            <button 
              onClick={() => { setShowBatchModal(true); setBatchLogs(["[READY] Start cover verification below..."]); }}
              className="px-1.5 py-0.5 bg-gold/10 hover:bg-gold/20 text-gold text-[11px] rounded uppercase font-mono font-black border border-gold/25 transition-colors cursor-pointer"
            >
              CRAWLER
            </button>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-black text-white">{stats.coverRate}%</div>
            <div className="w-full h-1 bg-zinc-950 rounded-full mt-2 overflow-hidden border border-zinc-900">
              <div className="h-full bg-gold" style={{ width: `${stats.coverRate}%` }} />
            </div>
          </div>
        </div>

        {/* MAL Alignment Rate Card */}
        <div className="bg-[#111215] border border-zinc-900/60 rounded-xl p-4 flex flex-col justify-between relative overflow-hidden backdrop-blur-md">
          <div className="absolute top-0 right-0 h-12 w-12 bg-[#FF3D2E]/5 rounded-full blur-xl" />
          <div className="flex justify-between items-start">
            <span className="text-[11px] uppercase font-mono tracking-wider text-zinc-400 flex items-center gap-1.5">
              <Award className="w-3.5 h-3.5 text-gold-bright" /> MAL Alignment
            </span>
            <button 
              onClick={() => { setShowBatchModal(true); setBatchLogs(["[READY] Start MAL synchronization below..."]); }}
              className="px-1.5 py-0.5 bg-indigo-ink/10 hover:bg-indigo-ink/20 text-gold-bright text-[11px] rounded uppercase font-mono font-black border border-indigo-ink/25 transition-colors cursor-pointer"
            >
              SYNC
            </button>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-black text-white">{stats.alignmentRate}%</div>
            <div className="w-full h-1 bg-zinc-950 rounded-full mt-2 overflow-hidden border border-zinc-900">
              <div className="h-full bg-indigo-ink" style={{ width: `${stats.alignmentRate}%` }} />
            </div>
          </div>
        </div>

        {/* Classification Tags Cards */}
        <div className="bg-[#111215] border border-zinc-900/60 rounded-xl p-4 flex flex-col justify-between relative overflow-hidden backdrop-blur-md">
          <div className="absolute top-0 right-0 h-12 w-12 bg-moss/5 rounded-full blur-xl" />
          <div className="flex justify-between items-start">
            <span className="text-[11px] uppercase font-mono tracking-wider text-zinc-400 flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-moss" /> Genre Meta Indices
            </span>
            <button 
              onClick={() => { setShowBatchModal(true); setBatchLogs(["[READY] Start Tag verification below..."]); }}
              className="px-1.5 py-0.5 bg-moss/10 hover:bg-moss/20 text-moss text-[11px] rounded uppercase font-mono font-black border border-moss/25 transition-colors cursor-pointer"
            >
              TAGGER
            </button>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-black text-white">{stats.tagRate}%</div>
            <div className="w-full h-1 bg-zinc-950 rounded-full mt-2 overflow-hidden border border-zinc-900">
              <div className="h-full bg-moss" style={{ width: `${stats.tagRate}%` }} />
            </div>
          </div>
        </div>

      </div>

      {/* Main Workspace Navigation Controls */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-2 border-b border-zinc-900/60 w-full overflow-hidden min-w-0">
        <div className="flex items-center gap-1.5 p-1 bg-zinc-950 border border-zinc-900 rounded-lg shrink-0 w-full overflow-x-auto scrollbar-hide md:max-w-none snap-x pb-2 md:pb-1">
          {(['proposals', 'catalog', 'maintenance', 'sandbox', 'artists', 'pokedex'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{ whiteSpace: 'nowrap' }}
              className={`px-3.5 py-1.5 rounded text-[11px] font-mono font-black uppercase tracking-wider transition-all cursor-pointer snap-start ${
                activeTab === tab
                  ? 'bg-zinc-900 border border-zinc-800 text-white shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab === 'proposals' ? 'Suggestions Inbox' : tab === 'catalog' ? 'Track Explorer' : tab === 'maintenance' ? 'Maintenance Hub' : tab === 'sandbox' ? 'Insertion Wizard' : tab === 'artists' ? 'Artist Profiles' : tab === 'pokedex' ? 'Pokedex Setup' : 'UI Combination Lab'}
              {tab === 'proposals' && proposals.filter(p => p.status === 'pending').length > 0 && (
                <span className="ml-2 px-1 py-0.5 rounded bg-vermillion text-white text-[11px] font-black leading-none">
                  {proposals.filter(p => p.status === 'pending').length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowBatchModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-primary/10 hover:bg-brand-primary text-brand-primary hover:text-black border border-brand-primary/20 hover:border-brand-primary rounded font-mono text-[11px] uppercase font-black cursor-pointer transition-all"
          >
            <Activity className="w-3 text-brand-primary hover:text-black" /> Run Diagnostics
          </button>
        </div>
      </div>

      {/* Verification YouTube Player panel */}
      {previewYtId && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="p-4 bg-zinc-950 border border-zinc-900 rounded-xl max-w-lg mx-auto shadow-2xl relative"
        >
          <div className="flex justify-between items-center mb-2.5">
            <span className="text-[11px] font-mono text-zinc-500 uppercase flex items-center gap-1.5">
              <Video className="w-3.5 h-3.5 text-vermillion" /> SRE Audio/Video Verification Screen
            </span>
            <button 
              onClick={() => setPreviewYtId(null)}
              className="text-zinc-500 hover:text-white font-mono text-[11px] uppercase cursor-pointer"
            >
              [Close Stream]
            </button>
          </div>
          <YoutubePlayer youtubeId={previewYtId} title="Moderator verification preview" />
        </motion.div>
      )}

      {/* Dynamic Tab Workspaces */}
      <AnimatePresence mode="wait">
        
        {/* TAB 1: Proposals inbox */}
        {activeTab === 'proposals' && (
          <motion.div
            key="proposals"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            <div className="flex justify-between items-center">
              <span className="text-zinc-500 text-[11px] font-mono uppercase tracking-widest flex items-center gap-1">
                <FileText className="w-4 h-4 text-vermillion" /> Pending user recommendations
              </span>
              <div className="flex gap-1 bg-zinc-950 p-1 border border-zinc-900 rounded">
                {(['pending', 'approved', 'rejected', 'all'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setProposalFilter(s)}
                    className={`px-2 py-1 rounded text-[11px] font-mono font-black uppercase tracking-wider ${
                      proposalFilter === s ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:text-zinc-400'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {filteredProposals.length === 0 ? (
              <div className="text-center py-16 bg-[#0A0805] border border-zinc-900/40 rounded-xl">
                <Clock className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
                <p className="text-zinc-400 text-sm">No recommendation tickets found.</p>
                <p className="text-zinc-600 font-mono text-[11px] mt-1 uppercase">// Database clean & indexed</p>
              </div>
            ) : (
              <div className="space-y-3.5">
                {filteredProposals.map((proposal) => {
                  const matchesExisting = proposal.type === 'fix_link' 
                    ? tracks.find(t => t.id === proposal.oldTrackId)
                    : null;

                  return (
                    <div
                      key={proposal.id}
                      className="p-5 bg-[#111215] border border-zinc-900/80 rounded-xl relative overflow-hidden flex flex-col md:flex-row gap-5 items-start justify-between"
                    >
                      <div className={`absolute top-0 bottom-0 left-0 w-1 ${
                        proposal.status === 'pending' 
                          ? proposal.type === 'add_track' ? 'bg-vermillion' : (proposal.type === 'report_comment' ? 'bg-rose-deep' : 'bg-indigo-ink')
                          : proposal.status === 'approved' ? 'bg-moss' : 'bg-rose-deep'
                      }`} />

                      <div className="flex-grow space-y-3 pl-2.5 max-w-3xl">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-[11px] font-black font-mono tracking-wider border ${
                            proposal.type === 'add_track'
                              ? 'bg-vermillion/10 text-vermillion border-vermillion/20'
                              : proposal.type === 'report_comment'
                              ? 'bg-rose-deep/10 text-vermillion-tint border-rose-deep/20'
                              : 'bg-indigo-ink/10 text-gold-bright border-indigo-ink/20'
                          }`}>
                            {proposal.type === 'add_track' ? 'INTEGRATION SUGGESTION' : proposal.type === 'report_comment' ? 'FLAGGED COMMENT' : 'STREAM RESOLUTION'}
                          </span>
                          <span className="flex items-center gap-1 text-[11px] font-mono text-zinc-500">
                            <User className="w-3 h-3 text-zinc-500" /> {proposal.submittedBy}
                          </span>
                          <span className="text-[11px] font-mono text-zinc-600">
                            {proposal.submittedAt}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                          
                          {/* Specifications Proposed Card */}
                          <div className="space-y-1">
                            <span className="text-[11px] font-mono text-zinc-500 uppercase block tracking-wider">// Recommendation Specs:</span>
                            <div className="font-sans">
                              <h4 className="font-black text-white text-sm uppercase leading-tight flex items-center gap-2">
                                {proposal.trackData.title}
                                <span className="text-[11px] font-mono font-black text-zinc-400 bg-zinc-950 border border-zinc-900 px-1.5 rounded leading-none">
                                  {proposal.trackData.type}
                                </span>
                              </h4>
                              <p className="text-zinc-400 text-xs mt-0.5">by {proposal.trackData.artist}</p>
                              <p className="text-[11px] font-mono text-zinc-500 uppercase mt-1 flex items-center gap-1.5">
                                <Tv className="w-3.5 h-3.5 text-zinc-600" /> Anime: {proposal.trackData.animeName}
                              </p>
                            </div>
                          </div>

                          {/* Fix specifics refer */}
                          {proposal.type === 'fix_link' && (
                            <div className="p-3 bg-zinc-950 border border-zinc-900/80 rounded-lg text-[11px] leading-relaxed font-mono">
                              <span className="text-[11px] text-gold-bright block font-black mb-1.5 uppercase tracking-widest">// Target Track DB Record</span>
                              {matchesExisting ? (
                                <div>
                                  <p className="text-zinc-300 font-bold truncate uppercase">{matchesExisting.title}</p>
                                  <p className="text-zinc-500 truncate">Series: {matchesExisting.animeName}</p>
                                  <div className="flex gap-2.5 mt-1.5">
                                    <span>Current WT: <code className="text-zinc-400 bg-zinc-900 px-1 rounded">{matchesExisting.youtubeId}</code></span>
                                    <span>Proposed: <code className="text-gold-bright bg-indigo-ink/10 px-1 rounded font-black">{proposal.proposedYtId}</code></span>
                                  </div>
                                </div>
                              ) : (
                                <span className="text-vermillion flex items-center gap-1">
                                  <AlertCircle className="w-3.5 h-3.5" /> Track record not currently indexed.
                                </span>
                              )}
                            </div>
                          )}

                        </div>

                        {proposal.notes && (
                          <div className="p-2.5 bg-zinc-950 border border-zinc-900/60 rounded text-xs text-zinc-400">
                            <span className="text-[11px] font-mono text-zinc-500 block mb-0.5 uppercase tracking-wider">// Submission Comments:</span>
                            {proposal.notes}
                          </div>
                        )}

                        {proposal.status === 'rejected' && (
                          <div className="p-2.5 bg-rose-deep/20 border border-rose-deep/30 text-vermillion rounded text-xs font-mono">
                            <span className="font-extrabold uppercase block mb-1">Rejection Reason Trace:</span>
                            {proposal.notes || 'No custom logic trace provided.'}
                          </div>
                        )}
                      </div>

                      {/* Controls column */}
                      <div className="flex flex-col gap-1.5 w-full md:w-36 shrink-0 border-t md:border-t-0 border-zinc-900 pt-3 md:pt-0">
                        <button
                          type="button"
                          onClick={() => setPreviewYtId(proposal.trackData.youtubeId || proposal.proposedYtId || '')}
                          className="px-3 py-2 border border-zinc-800 bg-zinc-950 hover:bg-zinc-900 text-zinc-400 hover:text-white rounded-lg text-[11px] font-mono font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5 text-vermillion" /> Preview Stream
                        </button>

                        {proposal.status === 'pending' && (
                          <>
                            {proposal.type === 'fix_link' && !proposal.proposedYtId && (
                              <button
                                type="button"
                                disabled={!!isResolvingId}
                                onClick={() => handleResolveProposal(proposal)}
                                className="px-3 py-2 bg-vermillion-hover text-black hover:bg-vermillion rounded-lg text-[11px] font-mono font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-lg disabled:opacity-50"
                              >
                                {isResolvingId === proposal.id ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Sparkles className="w-3.5 h-3.5" />}
                                Auto-Map Link
                              </button>
                            )}
                            
                            <button
                              type="button"
                              onClick={() => onApproveProposal(proposal.id)}
                              className="px-3 py-2 bg-moss text-black hover:bg-moss/80 rounded-lg text-[11px] font-mono font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-lg shadow-moss/10"
                            >
                              <Check className="w-3.5 h-3.5 stroke-[3px]" /> {proposal.type === 'report_comment' ? 'Delete Comment' : 'Integrate & Sync'}
                            </button>

                            {activeRejectingId === proposal.id ? (
                              <div className="space-y-1 mt-1">
                                <input
                                  type="text"
                                  value={rejectionNotes[proposal.id] || ''}
                                  onChange={(e) => setRejectionNotes(p => ({ ...p, [proposal.id]: e.target.value }))}
                                  placeholder="Reject logs comments..."
                                  className="w-full px-2.5 py-1.5 text-[11px] border border-vermillion/30 bg-black rounded text-zinc-300 font-mono outline-none"
                                />
                                <div className="flex gap-1">
                                  <button
                                    onClick={() => handleConfirmReject(proposal.id)}
                                    className="flex-1 px-2 py-1 bg-vermillion-hover hover:bg-vermillion text-white rounded text-[11px] font-mono uppercase font-black cursor-pointer"
                                  >
                                    Confirm
                                  </button>
                                  <button
                                    onClick={() => setActiveRejectingId(null)}
                                    className="px-2 py-1 bg-zinc-900 text-zinc-400 rounded text-[11px] font-mono uppercase font-black cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleStartReject(proposal.id)}
                                className="px-3 py-2 bg-vermillion/10 hover:bg-vermillion text-vermillion hover:text-black rounded-lg text-[11px] font-mono font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                              >
                                <XCircle className="w-3.5 h-3.5" /> Reject Ticket
                              </button>
                            )}
                          </>
                        )}
                      </div>

                    </div>
                  );
                })}
              </div>
            )}

            {proposals.length > 0 && proposalFilter !== 'pending' && (
              <div className="flex justify-end pt-2">
                <button
                  onClick={onClearHistory}
                  className="px-3 py-1.5 border border-zinc-900 bg-zinc-950 hover:bg-zinc-900 text-zinc-500 hover:text-white rounded text-[11px] font-mono font-black uppercase tracking-wider cursor-pointer transition-colors"
                >
                  Clear Review History Logs
                </button>
              </div>
            )}
          </motion.div>
        )}

        {/* TAB 2: Dynamic database explorer catalog */}
        {activeTab === 'catalog' && (
          <motion.div
            key="catalog"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            {/* Catalog Toolbar Filters */}
            <div className="bg-[#111215] border border-zinc-900/60 rounded-xl p-4 space-y-3.5">
              <div className="flex flex-col md:flex-row gap-3">
                
                {/* Search query box */}
                <div className="relative flex-1">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-3.5 w-3.5 text-zinc-500" />
                  </span>
                  <input
                    type="text"
                    placeholder="Search Title, Artist, Anime or Tags catalog..."
                    value={catalogSearch}
                    onChange={(e) => { setCatalogSearch(e.target.value); setCatalogPage(1); }}
                    className="w-full bg-zinc-950 border border-zinc-900 rounded-lg pl-9 pr-4 py-2 text-xs font-mono text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-vermillion/50"
                  />
                </div>

                {/* Type Filter Select buttons */}
                <div className="flex bg-zinc-950 rounded-lg p-1 border border-zinc-900 shrink-0">
                  {(['ALL', 'OP', 'ED', 'OST'] as const).map(type => (
                    <button
                      key={type}
                      onClick={() => { setCatalogTypeFilter(type); setCatalogPage(1); }}
                      className={`px-3 py-1 rounded text-[11px] font-mono font-black uppercase tracking-wider transition-colors ${
                        catalogTypeFilter === type ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:text-zinc-400'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>

                {/* SRE status filter selects */}
                <select
                  value={catalogCoverageFilter}
                  onChange={(e) => { setCatalogCoverageFilter(e.target.value as any); setCatalogPage(1); }}
                  className="bg-zinc-950 border border-zinc-900 text-zinc-500 rounded-lg px-3 py-2 text-[11px] uppercase font-mono tracking-wider focus:outline-none focus:text-white font-black"
                >
                  <option value="ALL">Show All Database</option>
                  <option value="MISSING_COVER">Missing Covers Target</option>
                  <option value="MISSING_TAGS">Missing Generative Tags</option>
                  <option value="MISSING_MAL_PART">Missing MAL aligned details</option>
                  <option value="HIGH_ELO">High rating themes (&gt; 1300 ELO)</option>
                </select>

              </div>
            </div>

            {/* Catalog Grid list */}
            {processedCatalogTracks.length === 0 ? (
              <div className="text-center py-16 bg-[#0A0805] border border-zinc-900/40 rounded-xl">
                <Search className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
                <p className="text-zinc-400 text-sm">No track models matched specifications.</p>
                <p className="text-zinc-600 font-mono text-[11px] mt-1 uppercase">// Try shifting search boundaries</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {paginatedCatalogTracks.map(track => {
                  const hasCustomCover = track.customImageUrl && !track.customImageUrl.includes("ytimg") && !track.customImageUrl.includes("youtube");
                  return (
                    <div 
                      key={track.id}
                      className="bg-[#111215] border border-zinc-900/60 rounded-xl p-3.5 flex items-center justify-between gap-3.5 relative hover:border-zinc-800 transition-colors group"
                    >
                      {/* Left Block: Image Cover & Basic Info */}
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="relative h-11 w-11 rounded-lg overflow-hidden shrink-0 bg-zinc-950 border border-zinc-800 flex items-center justify-center">
                          {track.customImageUrl ? (
                            <img 
                              src={track.customImageUrl} 
                              alt="Track Cover" 
                              className="h-full w-full object-cover" 
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <Play className="w-4 h-4 text-zinc-500" />
                          )}
                          <div className={`absolute bottom-0 right-0 h-2 w-2 rounded-full border border-black ${hasCustomCover ? 'bg-moss' : 'bg-vermillion'}`} title={hasCustomCover ? 'Premium Image Cover Linked' : 'Default YouTube Thumbnail'} />
                        </div>

                        <div className="overflow-hidden min-w-0">
                          <h4 className="text-white text-[11.5px] font-bold uppercase truncate group-hover:text-vermillion transition-colors flex items-center gap-1">
                            {track.title}
                          </h4>
                          <p className="text-zinc-500 text-[11px] truncate">by {track.artist || 'Unknown'}</p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="text-[11px] font-mono font-black text-white bg-zinc-950 border border-zinc-900 px-1 rounded uppercase">
                              {track.type}
                            </span>
                            <span className="text-[11px] font-mono text-zinc-500 uppercase truncate max-w-28">
                              {track.animeName}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Right Block: Actions & Elo */}
                      <div className="shrink-0 flex flex-col items-end justify-between h-full gap-2">
                        <span className="text-[11px] font-mono font-black text-vermillion bg-vermillion/5 border border-vermillion/10 px-1.5 py-0.5 rounded">
                          {Math.round(track.elo)} ELO
                        </span>
                        
                        <div className="flex gap-1.5 opacity-90 md:opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => setPreviewYtId(track.youtubeId)}
                            title="Play Audio Stream Preview"
                            className="p-1 border border-zinc-800 hover:border-vermillion text-zinc-500 hover:text-white hover:bg-zinc-900 rounded transition-all cursor-pointer"
                          >
                            <Play className="w-3.5 h-3.5 text-vermillion" />
                          </button>
                          <button
                            onClick={() => handleOpenEditor(track)}
                            title="Configure Technical Specifications"
                            className="p-1 border border-zinc-800 hover:border-indigo-ink text-zinc-500 hover:text-white hover:bg-zinc-900 rounded transition-all cursor-pointer"
                          >
                            <Edit className="w-3.5 h-3.5 text-gold-bright" />
                          </button>
                          <button
                            onClick={() => handleDeleteSingleTrack(track.id, track.title)}
                            title="Purge permanently from active catalog Database"
                            className="p-1 border border-zinc-800 hover:border-vermillion text-zinc-500 hover:text-white hover:bg-zinc-900 rounded transition-all cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-vermillion" />
                          </button>
                        </div>
                      </div>

                    </div>
                  );
                })}
              </div>
            )}

            {/* Pagination controls */}
            <div className="flex justify-between items-center pt-2.5">
              <span className="text-[11px] font-mono text-zinc-500 uppercase">
                Catalog: Shows {Math.min(processedCatalogTracks.length, (catalogPage - 1) * itemsPerPage + 1)} - {Math.min(processedCatalogTracks.length, catalogPage * itemsPerPage)} of {processedCatalogTracks.length} tracks
              </span>

              <div className="flex items-center gap-2">
                <button
                  disabled={catalogPage === 1}
                  onClick={() => setCatalogPage(prev => Math.max(1, prev - 1))}
                  className="p-1 border border-zinc-900 hover:border-zinc-800 bg-zinc-950 hover:bg-zinc-900 text-zinc-500 hover:text-white rounded disabled:opacity-40 transition-colors cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-[11px] font-mono text-zinc-300">
                  Page {catalogPage} of {catalogTotalPages}
                </span>
                <button
                  disabled={catalogPage === catalogTotalPages}
                  onClick={() => setCatalogPage(prev => Math.min(catalogTotalPages, prev + 1))}
                  className="p-1 border border-zinc-900 hover:border-zinc-800 bg-zinc-950 hover:bg-zinc-900 text-zinc-500 hover:text-white rounded disabled:opacity-40 transition-colors cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

          </motion.div>
        )}

        {/* TAB 3: Smart Maintenance commands hub */}
        {activeTab === 'maintenance' && (
          <motion.div
            key="maintenance"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            <div className="p-4 bg-zinc-950 rounded-xl border border-zinc-900/60 font-mono text-xs text-zinc-400">
              <span className="text-zinc-500 uppercase block mb-1">⚙️ Administration Core System Control Desk</span>
              Run these system processes periodically to audit links, realign, and categorize global metadata.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              
              {/* Box 1: Link Diagnostics check */}
              <div className="bg-[#111215] border border-zinc-900/60 p-4 rounded-xl flex flex-col justify-between space-y-3">
                <div>
                  <span className="text-[11px] font-mono font-black text-vermillion uppercase tracking-widest block">// Stream Auditor / Repairer</span>
                  <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">
                    Audits active database streams (youtubeIds) for silent bans, geoblocking, or deletion. Runs auto-recovery algorithms on error.
                  </p>
                </div>
                <button
                  onClick={startBatchVerification}
                  disabled={isBatchResolving || isTagging || isProcessingImages || isOstDiscovering || isAligningMAL || isSweepingDuplicates}
                  className="w-full text-center py-2 bg-rose-deep/25 hover:bg-rose-deep/50 text-vermillion border border-rose-deep/60 hover:border-vermillion rounded-lg font-mono text-[11px] uppercase font-black cursor-pointer transition-colors disabled:opacity-40"
                >
                  {isBatchResolving ? 'Diagnostic sweep in active process...' : 'Initialize stream audit'}
                </button>
              </div>

              {/* Box 2: Smart Artwork crawler */}
              <div className="bg-[#111215] border border-zinc-900/60 p-4 rounded-xl flex flex-col justify-between space-y-3">
                <div>
                  <span className="text-[11px] font-mono font-black text-gold uppercase tracking-widest block">// Cover Artwork Crawler</span>
                  <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">
                    Resolves high-resolution album-art graphics from iTunes metadata API and official MAL references to enrich player visually.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => startSmartImageBatch(false)}
                    disabled={isBatchResolving || isTagging || isProcessingImages || isOstDiscovering || isAligningMAL}
                    className="text-center py-2 bg-gold/25 hover:bg-gold/50 text-gold-bright border border-gold/60 rounded-lg font-mono text-[11px] uppercase font-black cursor-pointer disabled:opacity-40"
                  >
                    Fill gaps
                  </button>
                  <button
                    onClick={() => startSmartImageBatch(true)}
                    disabled={isBatchResolving || isTagging || isProcessingImages || isOstDiscovering || isAligningMAL}
                    className="text-center py-2 bg-gold hover:bg-gold-bright text-black rounded-lg font-mono text-[11px] uppercase font-black cursor-pointer disabled:opacity-40"
                  >
                    Force Refactor
                  </button>
                </div>
              </div>

              {/* Box 3: MAL alignment center */}
              <div className="bg-[#111215] border border-zinc-900/60 p-4 rounded-xl flex flex-col justify-between space-y-3">
                <div>
                  <span className="text-[11px] font-mono font-black text-gold-bright uppercase tracking-widest block">// Jikan MAL Index Realignment</span>
                  <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">
                    Cross-checks local tracks, resolves details against MyAnimeList and utilizes Gemini AI chunk sets to organize titles.
                  </p>
                </div>
                <button
                  onClick={startAnimeMalAlignmentBatch}
                  disabled={isBatchResolving || isTagging || isProcessingImages || isOstDiscovering || isAligningMAL}
                  className="w-full text-center py-2 bg-indigo-ink/25 hover:bg-indigo-ink/50 text-gold-bright border border-indigo-ink/60 rounded-lg font-mono text-[11px] uppercase font-black cursor-pointer disabled:opacity-40"
                >
                  {isAligningMAL ? 'AI Alignment active...' : 'Align Names with MAL'}
                </button>
              </div>

              {/* Box 4: Autotagger */}
              <div className="bg-[#111215] border border-zinc-900/60 p-4 rounded-xl flex flex-col justify-between space-y-3">
                <div>
                  <span className="text-[11px] font-mono font-black text-moss uppercase tracking-widest block">// Generative AI Descriptor Tagger</span>
                  <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">
                    Processes the catalog with Google Gemini AI to tag elements on style, sub-genres, emotional core, and vocal setups.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => startAutoTagBatch(true)}
                    disabled={isBatchResolving || isTagging || isProcessingImages || isOstDiscovering || isAligningMAL}
                    className="text-center py-2 bg-moss/25 hover:bg-moss/50 text-moss border border-moss/60 rounded-lg font-mono text-[11px] uppercase font-black cursor-pointer disabled:opacity-40"
                  >
                    Skip Tagged
                  </button>
                  <button
                    onClick={() => startAutoTagBatch(false)}
                    disabled={isBatchResolving || isTagging || isProcessingImages || isOstDiscovering || isAligningMAL}
                    className="text-center py-2 bg-moss hover:bg-moss/80 text-black rounded-lg font-mono text-[11px] uppercase font-black cursor-pointer disabled:opacity-40"
                  >
                    Force override
                  </button>
                </div>
              </div>

              {/* Box 5: Playlist curation discover scraper */}
              <div className="bg-[#111215] border border-zinc-900/60 p-4 rounded-xl flex flex-col justify-between space-y-3">
                <div>
                  <span className="text-[11px] font-mono font-black text-vermillion uppercase tracking-widest block">// Iconic OST Auto-Scraper</span>
                  <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">
                    Crawlers connect to iTunes stores and YouTube search nodes to harvest missing iconic soundtrack logs and auto-import them.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-4">
                  <button
                    onClick={async () => {
                      if (!onBulkAddTracks) return;
                      setIsOstDiscovering(true);
                      setOstDiscoveryProgress(0);
                      setBatchLogs(prev => [...prev, `[INIT] iTunes Album Crawler starting...`]);

                      const animesWithOsts = new Set(tracks.filter(t => t.type === 'OST').map(t => t.animeName));
                      const uniqueAnimes = Array.from(new Set(tracks.map(t => t.animeName)));
                      const animesWithoutOsts = uniqueAnimes.filter(a => !animesWithOsts.has(a));
                      const animes = animesWithoutOsts.slice(0, 5);
                      setBatchLogs(prev => [...prev, `[INFO] Processing ${animes.length} albums...`]);
                      setOstDiscoveryTotal(animes.length);
                      let total = 0;

                      for (let i = 0; i < animes.length; i++) {
                        const anime = animes[i];
                        try {
                          const res = await apiFetch(`/api/itunes-albums?animeName=${encodeURIComponent(anime)}`);
                          const data = await res.json();
                          if (data.osts && data.osts.length > 0) {
                            const added = await onBulkAddTracks(data.osts.map((o: any) => ({
                              id: `itunes_${Math.random().toString(36).substring(2, 11)}`,
                              title: o.title,
                              artist: o.artist,
                              animeName: anime,
                              type: 'OST',
                              youtubeId: o.youtubeId || "",
                              elo: 1200,
                              matchesPlayed: 0,
                              wins: 0,
                              losses: 0,
                              draws: 0,
                              tags: o.tags || ['iTunes_Album']
                            })));
                            total += added;
                            setBatchLogs(prev => [...prev, `[SUCCESS] Imported ${added} official tracks for "${anime}".`]);
                          }
                        } catch (e) {
                          setBatchLogs(prev => [...prev, `[ERROR] iTunes search failure for "${anime}"`]);
                        }
                        setOstDiscoveryProgress(i + 1);
                        await new Promise(r => setTimeout(r, 600));
                      }
                      setIsOstDiscovering(false);
                      toast.success(`iTunes Crawler complete. Linked ${total} soundtracks.`);
                    }}
                    disabled={isBatchResolving || isTagging || isProcessingImages || isOstDiscovering || isAligningMAL}
                    className="text-center py-2 bg-vermillion/20 hover:bg-vermillion/40 text-vermillion border border-vermillion rounded-lg font-mono text-[11px] uppercase font-black cursor-pointer disabled:opacity-40"
                  >
                    iTunes store
                  </button>

                  {/* YouTube Search Integration */}
                  <div className="space-y-2 pt-2 border-t border-zinc-900/50">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Youtube query (e.g. Bleach OST)..."
                        value={sandboxYoutubeQuery}
                        onChange={(e) => setSandboxYoutubeQuery(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSearchSandboxYoutube(); }}
                        className="flex-1 bg-zinc-950 border border-zinc-900 rounded-lg px-3 py-2 text-xs font-mono text-zinc-300 focus:outline-none focus:border-vermillion/50"
                      />
                      <button
                        onClick={handleSearchSandboxYoutube}
                        disabled={isSandboxSearchingYoutube || isFetchingPlaylist}
                        className="px-4 py-2 bg-vermillion-hover hover:bg-vermillion text-white rounded-lg text-xs font-mono font-black uppercase cursor-pointer transition-colors"
                      >
                        {isSandboxSearchingYoutube || isFetchingPlaylist ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
                      </button>
                    </div>

                    {(sandboxYoutubeResults.length > 0 || sandboxYoutubePlaylists.length > 0) && (
                      <div className="space-y-2 p-3 bg-zinc-950/65 rounded-lg border border-zinc-900/80">
                        {sandboxYoutubePlaylists.length > 0 && (
                          <div className="mb-4">
                            <h4 className="text-[11px] uppercase font-mono text-zinc-500 mb-2 border-b border-zinc-900/50 pb-1">Found Playlists</h4>
                            <div className="space-y-1 max-h-40 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-800 pr-1">
                              {sandboxYoutubePlaylists.map((pl, idx) => (
                                <button 
                                  key={idx}
                                  onClick={() => handleFetchPlaylist(pl.listId)}
                                  className="w-full text-left p-2 rounded bg-zinc-900/40 hover:bg-zinc-800/60 border border-transparent hover:border-zinc-700/50 flex justify-between items-center transition-colors group"
                                >
                                  <div className="flex flex-col overflow-hidden pr-2">
                                    <span className="text-[11px] text-zinc-200 truncate font-bold font-sans">{pl.title}</span>
                                    <span className="text-[11px] text-zinc-500 truncate">{pl.author} • {pl.videoCount} videos</span>
                                  </div>
                                  <MousePointer2 className="w-3.5 h-3.5 text-zinc-600 group-hover:text-vermillion flex-shrink-0" />
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {sandboxYoutubeResults.length > 0 && (
                          <>
                            <div className="flex justify-between items-center mb-2 pb-2 border-b border-zinc-900/50">
                              <span className="text-[11px] text-zinc-400 font-mono uppercase">{selectedSandboxYoutube.size} / {sandboxYoutubeResults.length} selected</span>
                              <button 
                                onClick={async () => {
                                  if (!onBulkAddTracks) return;
                                  const toImport = sandboxYoutubeResults.filter((_, idx) => selectedSandboxYoutube.has(idx)).map(v => ({
                                    id: `yt_${Math.random().toString(36).substring(2, 11)}`,
                                    title: v.title.replace(/\[.*?\]|\(.*?\)/g, "").trim(),
                                    artist: v.author || 'Various',
                                    animeName: sandboxYoutubeQuery,
                                    animePart: 'Season 1',
                                    type: 'OST' as TrackType,
                                    customImageUrl: '',
                                    youtubeId: v.videoId || "",
                                    elo: 1200,
                                    matchesPlayed: 0,
                                    wins: 0,
                                    losses: 0,
                                    draws: 0,
                                    tags: ['YouTube', 'Soundtrack']
                                  }));
                                  if (toImport.length === 0) return toast.error('No tracks selected');
                                  try {
                                    const count = await onBulkAddTracks(toImport);
                                    toast.success(`Imported ${count} tracks from YouTube!`);
                                    setSandboxYoutubeResults([]);
                                    if (currentCampaignIndex !== -1) {
                                      advanceCampaign();
                                    }
                                  } catch(e: any) {
                                    toast.error(e.message);
                                  }
                                }}
                                className="bg-vermillion-hover hover:bg-vermillion text-white px-3 py-1 rounded text-[11px] font-black uppercase tracking-widest transition-colors"
                              >
                                Import Selected
                              </button>
                            </div>

                            {/* Selection Helpers Row */}
                            <div className="flex flex-wrap items-center gap-1 bg-[#16171a]/75 p-1.5 rounded-lg border border-zinc-900 mb-2.5 text-[11px] font-mono justify-between text-zinc-400">
                              <span className="uppercase font-bold text-zinc-500 pl-1">Helpers:</span>
                              <div className="flex gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const allIndices = new Set<number>(sandboxYoutubeResults.map((_, idx) => idx));
                                    setSelectedSandboxYoutube(allIndices);
                                    toast.success("Selected all items!");
                                  }}
                                  className="px-1.5 py-0.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded hover:text-white transition-colors cursor-pointer uppercase font-black"
                                >
                                  Check All
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedSandboxYoutube(new Set());
                                    toast.info("Unchecked all items!");
                                  }}
                                  className="px-1.5 py-0.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded hover:text-white transition-colors cursor-pointer uppercase font-black"
                                >
                                  Uncheck All
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const ostOnly = new Set<number>();
                                    sandboxYoutubeResults.forEach((v, idx) => {
                                      if (!isOpeningOrEnding(v.title)) {
                                        ostOnly.add(idx);
                                      }
                                    });
                                    setSelectedSandboxYoutube(ostOnly);
                                    toast.success("Deselected OP/ED themes!");
                                  }}
                                  className="px-1.5 py-0.5 bg-rose-deep/30 hover:bg-rose-deep/60 border border-rose-deep/20 text-vermillion rounded hover:text-vermillion-tint transition-colors cursor-pointer uppercase font-bold"
                                >
                                  Exclude OP/EDs
                                </button>
                              </div>
                            </div>

                            <div className="max-h-[140px] overflow-y-auto space-y-1.5 scrollbar-thin scrollbar-thumb-zinc-800">
                              {sandboxYoutubeResults.map((v, i) => {
                                const isTheme = isOpeningOrEnding(v.title);
                                return (
                                  <div 
                                    key={i}
                                    className={`p-1 px-2 border rounded flex items-center justify-between transition-colors text-[11px] ${
                                      isTheme 
                                        ? 'border-rose-deep/50 bg-rose-deep/5 hover:bg-rose-deep/10 text-zinc-400' 
                                        : 'border-zinc-900 bg-zinc-950 hover:bg-zinc-900 text-zinc-300'
                                    }`}
                                  >
                                    <label className="flex items-center gap-2 cursor-pointer flex-1 truncate max-w-[150px] xl:max-w-[280px]">
                                      <input 
                                        type="checkbox"
                                        checked={selectedSandboxYoutube.has(i)}
                                        onChange={() => {
                                          setSelectedSandboxYoutube(prev => {
                                            const next = new Set(prev);
                                            if (next.has(i)) next.delete(i);
                                            else next.add(i);
                                            return next;
                                          });
                                        }}
                                        className="accent-vermillion bg-[#16171a] border border-zinc-900 cursor-pointer h-3 w-3 shrink-0"
                                      />
                                      {v.videoId && (
                                        <img 
                                          src={`https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`} 
                                          alt="" 
                                          className="w-11 h-6.5 object-cover rounded bg-zinc-900 border border-zinc-800 shrink-0 shadow-sm"
                                          referrerPolicy="no-referrer"
                                        />
                                      )}
                                      <span className={`font-bold truncate ${isTheme ? 'line-through text-zinc-500 decoration-rose-deep/50' : 'text-zinc-200'}`}>
                                        {v.title}
                                      </span>
                                    </label>
                                    <div className="flex items-center gap-2 shrink-0">
                                      {isTheme && (
                                        <span className="text-[11px] px-1 py-0.5 bg-rose-deep/80 text-vermillion font-mono font-bold uppercase rounded border border-rose-deep/40">
                                          Theme Excluded
                                        </span>
                                      )}
                                      <span className="text-[11px] font-mono text-zinc-500 uppercase">{v.duration || "N/A"}</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Box 6: Database Cleanser duplicates */}
              <div className="bg-[#111215] border border-zinc-900/60 p-4 rounded-xl flex flex-col justify-between space-y-3">
                <div>
                  <span className="text-[11px] font-mono font-black text-vermillion uppercase tracking-widest block">// Exact Duplicates Sweeper</span>
                  <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">
                    Queries and purges perfect duplicated tracks from the Firestore backend to keep the database performance clean.
                  </p>
                </div>
                <button
                  onClick={async () => {
                    if (onRemoveDuplicates) {
                      setIsSweepingDuplicates(true);
                      setBatchLogs(prev => [...prev, `[INIT] Core duplicates sweeper initiated ...`]);
                      await onRemoveDuplicates((msg) => {
                        setBatchLogs(prev => [...prev, `[Sweeper] ${msg}`]);
                      });
                      setBatchLogs(prev => [...prev, `[SUCCESS] Duplicate cleanup complete.`]);
                      setIsSweepingDuplicates(false);
                    }
                  }}
                  disabled={isBatchResolving || isTagging || isProcessingImages || isOstDiscovering || isAligningMAL || isSweepingDuplicates}
                  className="w-full text-center py-2 bg-rose-deep/10 hover:bg-vermillion text-vermillion hover:text-black hover:font-black border border-rose-deep/20 rounded-lg font-mono text-[11px] uppercase font-black cursor-pointer transition-all disabled:opacity-40"
                >
                  {isSweepingDuplicates ? "Sweeping Database..." : "Run dupe purge sweep"}
                </button>
              </div>

              {/* Box 7: Bulk Popular Anime Themes Importer */}
              <div className="bg-[#111215] border border-zinc-900/60 p-4 rounded-xl flex flex-col justify-between space-y-4">
                <div>
                  <span className="text-[11px] font-mono font-black text-vermillion uppercase tracking-widest block">// Target Acquisition: OPs / EDs</span>
                  <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">
                    Automatically harvests top Opening and Ending themes from the highest rated and most popular active series to bulk populate the catalog rapidly.
                  </p>
                </div>
                
                {/* Advanced Controls */}
                <div className="space-y-2.5 bg-zinc-950/40 p-2.5 rounded-lg border border-zinc-900/40 font-mono text-[11px]">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-zinc-500 uppercase tracking-widest block mb-1 font-bold">Import Count:</label>
                      <input 
                        type="number"
                        min="1"
                        max="1000"
                        value={bulkImportLimit}
                        onChange={(e) => setBulkImportLimit(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-full bg-[#16171a] border border-zinc-900 text-white rounded px-2 py-1 text-[11px] focus:outline-none focus:border-vermillion transition-colors"
                      />
                    </div>
                    <div>
                      <span className="text-zinc-500 uppercase tracking-widest block mb-1 font-bold">Auto Starting Page:</span>
                      <div className="w-full bg-[#16171a]/80 border border-zinc-900 text-vermillion rounded px-2.5 py-1 text-[11px] font-sans font-black flex justify-between items-center">
                        <span>Page {bulkStartPage}</span>
                        <span className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider font-normal bg-rose-deep/40 px-1 py-0.5 rounded border border-rose-deep/10">Dynamic Tracking</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-1.5 pt-1">
                    <input 
                      type="checkbox"
                      id="bulkKeepOrder"
                      checked={bulkKeepOrder}
                      onChange={(e) => setBulkKeepOrder(e.target.checked)}
                      className="accent-vermillion border border-zinc-900 bg-[#16171a] h-3.5 w-3.5 rounded cursor-pointer"
                    />
                    <label htmlFor="bulkKeepOrder" className="text-zinc-400 font-bold uppercase tracking-wide cursor-pointer text-[11px]">
                      Keep strict popularity ranking order
                    </label>
                  </div>
                </div>

                <button
                  onClick={async () => {
                    if (!onBulkAddTracks) return;
                    setIsBulkImporting(true);
                    setInteractivePhase('anime-select');
                    setInteractiveSelectedAnime(new Set());
                    setInteractiveImportedCount(0);
                    setInteractiveStep(0);
                    setInteractiveTrackStep(0);
                    setInteractiveThemes([]);
                    setInteractiveSelectedTracks(new Set());
                    setInteractiveTypeOverrides({});
                    setInteractiveDefaultType('AUTO');
                    setInteractiveTrackSelections({});
                    setBatchLogs(prev => [...prev, `[INIT] Fetching top ${bulkImportLimit} anime from AniList (page ${bulkStartPage})...`]);
                    try {
                      const listRes = await apiFetch(`/api/bulk-anime-list?limit=${bulkImportLimit}&startPage=${bulkStartPage}`);
                      const listData = await listRes.json();
                      if (!listData?.anime || listData.anime.length === 0) {
                        setBatchLogs(prev => [...prev, `[WARN] No anime found.`]);
                        setIsBulkImporting(false);
                        return;
                      }
                      setBatchLogs(prev => [...prev, `[INFO] Found ${listData.anime.length} anime. Select which to import.`]);
                      setInteractiveAnimeList(listData.anime);
                      setInteractivePageInfo(listData.pageInfo || null);
                    } catch (e: any) {
                      setBatchLogs(prev => [...prev, `[ERROR] ${e.message}`]);
                      setIsBulkImporting(false);
                    }
                  }}
                  disabled={isBatchResolving || isTagging || isProcessingImages || isOstDiscovering || isAligningMAL || isSweepingDuplicates || isBulkImporting}
                  className="w-full text-center py-2 bg-vermillion hover:bg-vermillion-hover text-black border border-vermillion/20 rounded-lg font-mono text-[11px] uppercase font-black cursor-pointer transition-all disabled:opacity-40"
                >
                  {isBulkImporting ? "Loading Top Anime from AniList..." : `Smart Import: Top 50 Anime (Page ${bulkStartPage})`}
                </button>
                {bulkStartPage > 1 && (
                  <button
                    onClick={() => {
                      setBulkStartPage(1);
                      localStorage.setItem('bulkStartPage', '1');
                      toast.success('Page tracking reset to 1');
                    }}
                    className="w-full text-center py-1.5 mt-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 border border-zinc-700 rounded-lg font-mono text-[10px] uppercase font-bold cursor-pointer transition-all"
                  >
                    Reset to Page 1
                  </button>
                )}

              {/* Unified Smart Import — anime selection + optional track details */}
              {interactiveAnimeList.length > 0 && (
                <div className="mt-4 p-4 bg-[#100C0A] border border-rose-deep/30 rounded-xl space-y-3">
                  {/* Progress */}
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono text-vermillion uppercase tracking-wider font-bold">
                      Anime {interactiveStep + 1} / {interactiveAnimeList.length}
                    </span>
                    <span className="text-[11px] font-mono text-zinc-500">
                      {interactiveSelectedAnime.size} selected
                    </span>
                  </div>

                  {/* Current anime card with cover art */}
                  {(() => {
                    const currentAnime = interactiveAnimeList[interactiveStep];
                    const isSelected = interactiveSelectedAnime.has(interactiveStep);
                    const isMovie = currentAnime?.format === 'MOVIE';
                    return (
                      <>
                        <div className={`flex items-center gap-4 p-3 rounded-xl border-2 transition-all ${isSelected ? 'border-vermillion bg-vermillion/5' : 'border-zinc-800 bg-zinc-950'}`}>
                          {currentAnime?.cover ? (
                            <img src={currentAnime.cover} className="w-16 h-24 object-cover rounded-lg shrink-0" loading="lazy" />
                          ) : (
                            <div className="w-16 h-24 bg-zinc-800 rounded-lg shrink-0 flex items-center justify-center">
                              <Tv className="w-6 h-6 text-zinc-700" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <h4 className="text-sm font-bold text-white truncate">{currentAnime?.title}</h4>
                            <p className="text-[10px] text-zinc-500 mt-0.5">
                              {currentAnime?.format || 'TV'} {currentAnime?.year ? ' ' + currentAnime.year : ''}
                              {currentAnime?.episodes ? ' ' + currentAnime.episodes + ' eps' : ''}
                              {isMovie ? ' 🎬' : ''}
                            </p>
                            {isSelected && (
                              <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded bg-vermillion/20 text-vermillion text-[9px] font-mono font-bold uppercase">
                                <Check className="w-2.5 h-2.5" /> Selected
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Toggle selection + navigate */}
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => {
                              setInteractiveSelectedAnime(prev => {
                                const next = new Set(prev);
                                if (next.has(interactiveStep)) next.delete(interactiveStep);
                                else next.add(interactiveStep);
                                return next;
                              });
                            }}
                            className={`flex-1 min-w-[120px] py-2.5 rounded-lg font-black text-xs uppercase tracking-wider transition-all ${
                              isSelected ? 'bg-zinc-700 text-white hover:bg-zinc-600' : 'bg-vermillion text-white hover:bg-vermillion-hover'
                            }`}
                          >
                            {isSelected ? 'Deselect' : 'Select'}
                          </button>
                          {interactiveStep > 0 && (
                            <button onClick={() => setInteractiveStep(interactiveStep - 1)}
                              className="px-3 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white text-xs font-bold">Prev</button>
                          )}
                          {interactiveStep + 1 < interactiveAnimeList.length && (
                            <button onClick={() => setInteractiveStep(interactiveStep + 1)}
                              className="px-3 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white text-xs font-bold">Next</button>
                          )}
                          <button onClick={() => {
                            const all = new Set<number>();
                            interactiveAnimeList.forEach((_, i) => all.add(i));
                            setInteractiveSelectedAnime(all);
                          }} className="px-3 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white text-xs font-bold">All</button>
                          <button onClick={() => setInteractiveSelectedAnime(new Set())}
                            className="px-3 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white text-xs font-bold">None</button>
                        </div>

                        {/* Optional: expand track details for this anime */}
                        {isSelected && (
                          <details open className="mt-2">
                            <summary className="cursor-pointer text-[11px] font-mono text-zinc-500 hover:text-zinc-300 uppercase tracking-wider select-none">
                              Track Selection (select which sub-anime to include)
                            </summary>
                            <TrackDetailPanel
                              animeTitle={currentAnime?.title}
                              isMovie={isMovie}
                              onTrackTypeOverride={(trackId, type) => {
                                setInteractiveTypeOverrides(prev => ({ ...prev, [trackId]: type }));
                              }}
                              typeOverrides={interactiveTypeOverrides}
                              defaultType={interactiveDefaultType}
                              onDefaultTypeChange={setInteractiveDefaultType}
                              onSelectedTracksChange={(indices: number[]) => {
                                setInteractiveTrackSelections(prev => ({ ...prev, [interactiveStep]: indices }));
                              }}
                            />
                          </details>
                        )}
                      </>
                    );
                  })()}

                  {/* Import button — imports ALL themes from ALL selected anime */}
                  <button
                    onClick={async () => {
                      if (interactiveSelectedAnime.size === 0) { toast.error('Select at least one anime'); return; }
                      const selectedIndices = Array.from(interactiveSelectedAnime).sort((a, b) => a - b);
                      setBatchLogs(prev => [...prev, `[IMPORT] Starting import for ${selectedIndices.length} anime...`]);
                      let totalImported = 0;
                      for (let s = 0; s < selectedIndices.length; s++) {
                        const animeIdx = selectedIndices[s];
                        const anime = interactiveAnimeList[animeIdx];
                        const isMovie = anime?.format === 'MOVIE';
                        setBatchLogs(prev => [...prev, `[FETCH] (${s+1}/${selectedIndices.length}) Loading themes for "${anime.title}"...`]);
                        try {
                          const res = await apiFetch(`/api/animethemes-search?animeName=${encodeURIComponent(anime.title)}`);
                          const data = await res.json();
                          if (data.tracks && data.tracks.length > 0) {
                            // If the user used the track panel, only import selected tracks.
                            // If they didn't expand the panel (no entry in interactiveTrackSelections), import ALL tracks (default).
                            // If they expanded it but deselected everything, skip this anime.
                            const trackSelection = interactiveTrackSelections[animeIdx];
                            const tracksToFilter = trackSelection
                              ? data.tracks.filter((_: any, i: number) => trackSelection.includes(i))
                              : data.tracks;
                            if (tracksToFilter.length === 0) {
                              setBatchLogs(prev => [...prev, `[SKIP] No tracks selected for "${anime.title}" — skipping.`]);
                              continue;
                            }
                            const tracksToImport = tracksToFilter.map((t: any) => {
                              const effectiveType = isMovie ? 'OST' : t.type;
                              return {
                                id: `import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                                title: t.title, artist: t.artist, animeName: t.animeName || anime.title,
                                type: effectiveType, youtubeId: '', elo: 1200, matchesPlayed: 0,
                                wins: 0, losses: 0, draws: 0, addedByUser: false, tags: ['Hype'],
                              } as AnimeTrack;
                            });
                            await onBulkAddTracks(tracksToImport);
                            totalImported += tracksToImport.length;
                            setBatchLogs(prev => [...prev, `[OK] Imported ${tracksToImport.length} tracks from "${anime.title}"`]);
                          } else {
                            setBatchLogs(prev => [...prev, `[SKIP] No themes found for "${anime.title}"`]);
                          }
                        } catch {
                          setBatchLogs(prev => [...prev, `[WARN] Failed to fetch themes for "${anime.title}"`]);
                        }
                      }
                      setBatchLogs(prev => [...prev, `[DONE] Import complete. ${totalImported} tracks from ${selectedIndices.length} anime.`]);
                      toast.success(`Imported ${totalImported} tracks from ${selectedIndices.length} anime!`);
                      // Advance page
                      const nextPage = (interactivePageInfo?.currentPage || 1) + 1;
                      const hasNextPage = interactivePageInfo?.hasNextPage;
                      if (hasNextPage) {
                        setBulkStartPage(nextPage);
                        localStorage.setItem('bulkStartPage', String(nextPage));
                      }
                      setInteractiveAnimeList([]);
                      setInteractiveSelectedAnime(new Set());
                      setInteractiveStep(0);
                      setIsBulkImporting(false);
                    }}
                    disabled={interactiveSelectedAnime.size === 0 || !onBulkAddTracks}
                    className="w-full py-3 rounded-lg bg-moss text-zinc-950 font-black text-sm uppercase tracking-wider hover:bg-moss/80 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    Import All Themes ({interactiveSelectedAnime.size} anime) →
                  </button>

                  {/* Cancel */}
                  <button
                    onClick={() => {
                      setInteractiveAnimeList([]);
                      setInteractiveSelectedAnime(new Set());
                      setInteractiveStep(0);
                      setIsBulkImporting(false);
                    }}
                    className="w-full py-2 rounded-lg bg-rose-deep/10 border border-rose-deep/30 text-vermillion-tint font-black text-xs uppercase tracking-wider hover:bg-rose-deep/20 transition-all"
                  >
                    Cancel
                  </button>
                </div>
              )}

            </div>


            </div>

            {/* Diagnostic Logs terminal feed at bottom of tab */}
            <div className="space-y-2 pt-2.5">
              <span className="text-[11px] font-mono text-zinc-500 uppercase flex items-center gap-1.5">
                <Code className="w-3.5 h-3.5" /> Core SRE execution monitor stream:
              </span>

              {(isBatchResolving || isTagging || isProcessingImages || isAligningMAL || isOstDiscovering || isSweepingDuplicates || isBulkImporting) && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[11px] font-mono uppercase text-zinc-400">
                    <span>Task progress:</span>
                    <span>
                      {isSweepingDuplicates ? "System Analytics Engine Running..." :
                       isBulkImporting ? "Injecting Payload Signatures to Repositories..." :
                       isBatchResolving ? `${batchProgress} / ${batchTotal}` : 
                       isTagging ? `${taggingProgress} / ${taggingTotal}` : 
                       isProcessingImages ? `${imagesProgress} / ${imagesTotal}` : 
                       isOstDiscovering ? `${ostDiscoveryProgress} / ${ostDiscoveryTotal}` :
                       `${alignProgress} / ${alignTotal}`}
                    </span>
                  </div>
                  <div className="w-full h-1 bg-zinc-950 border border-zinc-900 rounded-full overflow-hidden">
                    <motion.div 
                      className="h-full bg-vermillion"
                      initial={{ width: 0 }}
                      animate={{ 
                        width: isSweepingDuplicates || isBulkImporting ? "100%" : `${
                          isBatchResolving ? (batchProgress / (batchTotal || 1)) * 100 :
                          isTagging ? (taggingProgress / (taggingTotal || 1)) * 100 :
                          isProcessingImages ? (imagesProgress / (imagesTotal || 1)) * 100 :
                          isOstDiscovering ? (ostDiscoveryProgress / (ostDiscoveryTotal || 1)) * 100 :
                          (alignProgress / (alignTotal || 1)) * 100
                        }%`
                      }}
                      transition={(isSweepingDuplicates || isBulkImporting) ? { repeat: Infinity, duration: 2, ease: "linear", repeatType: "mirror" } : {}}
                    />
                  </div>
                </div>
              )}

              <div className="bg-black/95 rounded-xl border border-zinc-900 p-3.5 h-64 overflow-y-auto font-mono text-[11px] text-[#A0AABA] space-y-1.5 scroll-smooth shadow-inner">
                {batchLogs.length === 0 ? (
                  <div className="h-full w-full flex items-center justify-center opacity-30 select-none">// Awaiting system execution initialization parameters...</div>
                ) : (
                  batchLogs.map((log, i) => (
                    <div key={i} className={`
                      ${log.includes('[SUCCESS]') ? 'text-moss' : ''}
                      ${log.includes('[FAIL]') ? 'text-gold' : ''}
                      ${log.includes('[ERROR]') ? 'text-vermillion' : ''}
                      ${log.includes('[INIT]') ? 'text-gold-bright font-black' : ''}
                      ${log.includes('[Sweeper]') ? 'text-vermillion-tint' : ''}
                      ${log.includes('[COMPLETE]') ? 'text-vermillion font-black' : ''}
                    `}>
                      &gt; {log}
                    </div>
                  ))
                )}
                <div ref={logsEndRef} />
              </div>
            </div>

          </motion.div>
        )}

        {/* TAB 4: Sandbox metadata alignment insertion assistant */}
        {activeTab === 'sandbox' && (
          <motion.div
            key="sandbox"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            
            {/* Semi-Automatic OST Campaign Wizard Control Center */}
            <div className="bg-[#111215] border border-zinc-900/60 p-5 rounded-xl space-y-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-zinc-900/50 pb-4">
                <div>
                  <h3 className="text-white text-xs uppercase font-mono tracking-widest flex items-center gap-2 font-black">
                    <Sparkles className="w-5 h-5 text-vermillion" /> Semi-Automatic OST Campaign Wizard
                  </h3>
                  <p className="text-zinc-500 text-[11px] font-mono mt-0.5 uppercase">// Sequential smart bulk soundtrack harvester</p>
                </div>
                
                {currentCampaignIndex === -1 ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => initializeCampaign('all')}
                      className="px-4 py-2 bg-vermillion/10 hover:bg-vermillion hover:text-black border border-vermillion/20 text-vermillion text-[11px] font-mono font-black uppercase rounded-lg transition-all cursor-pointer"
                    >
                      Campaign: All Series ({campaignStats.totalSeries})
                    </button>
                    <button
                      onClick={() => initializeCampaign('no-osts')}
                      className="px-4 py-2 bg-moss/10 hover:bg-moss hover:text-black border border-moss/30 text-moss text-[11px] font-mono font-black uppercase rounded-lg transition-all cursor-pointer"
                    >
                      Campaign: Missing OSTs ({campaignStats.missingOstSeriesCount})
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <span className="text-[11px] font-mono text-zinc-500 block uppercase">Auto-Pilot Progress</span>
                      <span className="text-[11px] text-zinc-200 font-bold font-sans">
                        Franchise {currentCampaignIndex + 1} of {campaignQueue.length}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={advanceCampaign}
                        className="px-3 py-1.5 bg-gold hover:bg-gold-bright text-black text-[11px] font-mono font-black uppercase rounded border border-gold/30 transition-all cursor-pointer"
                        title="Skip current anime and move to next"
                      >
                        Skip Series ⏭️
                      </button>
                      <button
                        onClick={() => {
                          setCurrentCampaignIndex(-1);
                          setCampaignQueue([]);
                          toast.error("Campaign process aborted.");
                        }}
                        className="px-3 py-1.5 bg-rose-deep hover:bg-vermillion text-white text-[11px] font-mono font-bold uppercase rounded border border-rose-deep/30 transition-all cursor-pointer"
                      >
                        Stop Campaign 🛑
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {currentCampaignIndex !== -1 && (
                <div className="space-y-3.5 bg-zinc-950/45 p-4 rounded-lg border border-zinc-900/60 font-mono text-[11px]">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-zinc-900/40 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold px-1.5 py-0.5 bg-vermillion text-black uppercase rounded">ACTIVE CAMPAIGN ROUTE</span>
                      <span className="text-vermillion font-bold text-xs font-sans">"{campaignQueue[currentCampaignIndex]}"</span>
                    </div>
                    <span className="text-zinc-500 text-[11px] uppercase font-bold">
                      {Math.round(((currentCampaignIndex + 1) / campaignQueue.length) * 100)}% Complete
                    </span>
                  </div>
                  
                  {/* Progress bar */}
                  <div className="w-full bg-[#16171a] h-2 rounded-full overflow-hidden border border-zinc-900/80">
                    <div 
                      className="bg-vermillion h-full transition-all duration-300"
                      style={{ width: `${((currentCampaignIndex + 1) / campaignQueue.length) * 100}%` }}
                    />
                  </div>
                  
                  <p className="text-zinc-400 text-[11px] leading-relaxed">
                    ⚙️ Auto-pilot is executing search. Please select a dynamic soundtrack playlist or import official suggestions below. Once any source import completes, the campaign will instantly transition to the next franchise in queue.
                  </p>
                </div>
              )}

              {currentCampaignIndex === -1 && (
                <div className="p-3 bg-zinc-950/20 rounded-lg border border-zinc-900/30 text-[11px] text-zinc-500 leading-relaxed font-mono">
                  💡 **Campaign automation** sequentially traverses every anime in your catalog. No research required. Pick a campaign mode above to begin auto-populating! Excludes opening and ending tracks by default.
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* Sandbox MAL query explorer card */}
              <div className="space-y-4 bg-[#111215] border border-zinc-900/60 p-5 rounded-xl">
              <div>
                <h3 className="text-white text-xs uppercase font-mono tracking-widest flex items-center gap-1.5 font-black">
                  <Layers className="w-4 h-4 text-vermillion" /> Jikan MAL Auto-lookup
                </h3>
                <p className="text-zinc-500 text-[11px] font-mono mt-0.5 uppercase">// Pull official metadata records dynamically</p>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Enter franchise name (e.g., Attack on Titan, K-ON)..."
                  value={sandboxAnimeQuery}
                  onChange={(e) => setSandboxAnimeQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSearchSandboxMAL(); }}
                  className="flex-1 bg-zinc-950 border border-zinc-900 rounded-lg px-3 py-2 text-xs font-mono text-zinc-300 focus:outline-none focus:border-vermillion/50"
                />
                <button
                  onClick={handleSearchSandboxMAL}
                  disabled={isSandboxSearchingMAL}
                  className="px-4 py-2 bg-vermillion hover:bg-vermillion-hover text-black rounded-lg text-xs font-mono font-black uppercase cursor-pointer transition-colors"
                >
                  {isSandboxSearchingMAL ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
                </button>
              </div>

              {sandboxMalResults.length > 0 && (
                <div className="p-1 px-1.5 bg-zinc-950 border border-zinc-900/80 rounded max-h-[320px] overflow-y-auto space-y-2">
                  <span className="text-[11px] text-zinc-500 font-mono block py-1 uppercase tracking-wider">Results of active MAL database search:</span>
                  {sandboxMalResults.slice(0, 6).map((item) => (
                    <div 
                      key={item.mal_id}
                      onClick={() => handleSelectSandboxMAL(item)}
                      className={`p-2 rounded border cursor-pointer flex gap-3 transition-colors ${
                        selectedSandboxMalItem?.mal_id === item.mal_id 
                          ? 'bg-vermillion/10 border-vermillion/50 text-white' 
                          : 'bg-[#101114] border-zinc-900 hover:border-zinc-800'
                      }`}
                    >
                      {item.images?.jpg?.image_url && (
                        <img 
                          src={item.images.jpg.image_url} 
                          alt="Cover Thumbnail" 
                          className="h-10 w-8.5 object-cover rounded" 
                        />
                      )}
                      <div>
                        <p className="text-[11px] font-bold uppercase line-clamp-1">{item.title}</p>
                        <p className="text-[11px] text-zinc-500 font-mono uppercase">{item.year ? `Year ${item.year}` : 'Classic'} / {item.type || 'TV'}</p>
                        <span className="text-[11px] text-vermillion block hover:underline mt-0.5">Click to suggest tracklists</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {selectedSandboxMalItem && (
                <div className="space-y-4 border-t border-zinc-900/40 pt-4 font-mono">
                  
                  {/* Selected MAL franchise header card decoration */}
                  <div className="flex items-center gap-3 bg-zinc-950 p-2.5 rounded-lg border border-zinc-900/80">
                    {selectedSandboxMalItem.images?.jpg?.image_url && (
                      <img 
                        src={selectedSandboxMalItem.images.jpg.image_url} 
                        alt="Thumbnail" 
                        className="h-12 w-9 object-cover rounded shadow" 
                        referrerPolicy="no-referrer"
                      />
                    )}
                    <div className="overflow-hidden">
                      <span className="text-[11px] font-mono text-vermillion uppercase block font-bold tracking-wider">SELECTED FRANCHISE</span>
                      <h4 className="text-[11px] font-extrabold text-zinc-100 uppercase truncate font-sans">{selectedSandboxMalItem.title}</h4>
                      <p className="text-[11px] font-mono text-zinc-500 mt-0.5 uppercase">
                        // {selectedSandboxMalItem.year || 'Classic'} • {selectedSandboxMalItem.type || 'TV'}
                      </p>
                    </div>
                  </div>

                  {/* Playlist Search Row */}
                  <div className="space-y-3 p-3.5 bg-zinc-950/40 border border-zinc-900/60 rounded-xl">
                    <div className="flex justify-between items-center dropdown-label">
                      <span className="text-[11px] text-zinc-400 font-bold uppercase flex items-center gap-1.5 leading-none">
                        <Youtube className="w-4 h-4 text-vermillion" /> YouTube Playlist Harvester
                      </span>
                      <span className="text-[11px] text-zinc-500 font-mono uppercase font-semibold">// soundtrack collector</span>
                    </div>

                    <div className="flex gap-2">
                      <input 
                        type="text"
                        placeholder="Soundtrack query (e.g. Bleach soundtrack)..."
                        value={sandboxYoutubeQuery}
                        onChange={(e) => setSandboxYoutubeQuery(e.target.value)}
                        className="flex-1 bg-zinc-950 border border-zinc-900 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-vermillion/50"
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSearchSandboxYoutube(); }}
                      />
                      <button
                        onClick={handleSearchSandboxYoutube}
                        disabled={isSandboxSearchingYoutube || isFetchingPlaylist}
                        className="px-4 py-1.5 bg-vermillion hover:bg-vermillion-hover text-black rounded-lg text-xs font-mono font-black uppercase cursor-pointer transition-all flex items-center gap-1"
                      >
                        {isSandboxSearchingYoutube ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Search'}
                      </button>
                    </div>

                    {/* Playlists listing */}
                    {sandboxYoutubePlaylists.length > 0 && (
                      <div className="space-y-2 pt-1 border-t border-zinc-900/30">
                        <div className="flex justify-between items-center">
                          <span className="text-[11px] text-vermillion font-mono block uppercase tracking-wider font-extrabold">STEP 1: Select Video Album / Playlists:</span>
                          <span className="text-[11px] text-zinc-500 font-mono uppercase">
                            {selectedPlaylists.size} Selected
                          </span>
                        </div>
                        <div className="space-y-1.5 max-h-44 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-800 pr-1">
                          {sandboxYoutubePlaylists.map((pl, idx) => {
                            const isChecked = selectedPlaylists.has(pl.listId);
                            return (
                              <div 
                                key={idx}
                                onClick={() => {
                                  setSelectedPlaylists(prev => {
                                    const next = new Set(prev);
                                    if (next.has(pl.listId)) {
                                      next.delete(pl.listId);
                                    } else {
                                      next.add(pl.listId);
                                    }
                                    return next;
                                  });
                                }}
                                className={`w-full text-left p-2 rounded border flex justify-between items-center transition-all group cursor-pointer ${
                                  isChecked 
                                    ? 'bg-vermillion/10 border-vermillion/50 hover:bg-vermillion/15' 
                                    : 'bg-zinc-950 hover:bg-zinc-900 border-zinc-900/60 hover:border-zinc-700/50'
                                }`}
                              >
                                <div className="flex items-center gap-2 overflow-hidden pr-2">
                                  <input 
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => {}} // handled by parent click handler
                                    className="accent-vermillion bg-[#16171a] border border-zinc-900 cursor-pointer h-3.5 w-3.5 shrink-0"
                                  />
                                  <div className="flex flex-col overflow-hidden">
                                    <span className={`text-[11px] truncate font-extrabold font-sans transition-colors ${
                                      isChecked ? 'text-vermillion' : 'text-zinc-200 group-hover:text-vermillion'
                                    }`}>
                                      {pl.title}
                                    </span>
                                    <span className="text-[11px] text-zinc-500 truncate font-mono uppercase mt-0.5">
                                      {pl.author} • {pl.videoCount} soundtracks
                                    </span>
                                  </div>
                                </div>
                                <Play className={`w-3 h-3 shrink-0 transform group-hover:-translate-y-0.5 group-hover:shadow-md transition-transform ${
                                  isChecked ? 'text-vermillion' : 'text-zinc-600 group-hover:text-vermillion'
                                }`} />
                              </div>
                            );
                          })}
                        </div>
                        
                        {/* Trigger button for multi-playlist load */}
                        {selectedPlaylists.size > 0 && (
                          <button
                            onClick={() => handleFetchSelectedPlaylists(Array.from(selectedPlaylists))}
                            disabled={isFetchingPlaylist}
                            className="w-full text-center py-2.5 mt-2 bg-vermillion hover:bg-vermillion-hover disabled:bg-rose-deep/30 text-black border border-vermillion/20 rounded-lg font-mono text-[11px] uppercase font-black cursor-pointer transition-all flex items-center justify-center gap-1.5 shadow-lg active:scale-[0.98]"
                          >
                            {isFetchingPlaylist ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Fetching & Aggregating Selected...
                              </>
                            ) : (
                              <>
                                <Play className="w-3 h-3 fill-black text-black" /> Fetch Tracks from {selectedPlaylists.size} Selected Playlists
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Individual Playlist Tracks with Checkboxes */}
                    {isFetchingPlaylist ? (
                      <div className="flex items-center gap-2 py-8 justify-center text-zinc-500 font-mono text-[11px] uppercase font-bold border-t border-zinc-900/30">
                        <Loader2 className="w-4 h-4 animate-spin text-vermillion" /> Resolving Playlist Tracks Stream from YT API...
                      </div>
                    ) : sandboxYoutubeResults.length > 0 ? (
                      <div className="space-y-2.5 pt-2.5 border-t border-zinc-900/50 mt-2">
                        <div className="flex justify-between items-center">
                          <span className="text-[11px] text-zinc-400 uppercase font-extrabold">
                            STEP 2: Review Tracks ({selectedSandboxYoutube.size} / {sandboxYoutubeResults.length} selected)
                          </span>
                          <button 
                            onClick={async () => {
                              if (!onBulkAddTracks) return;
                              const toImport = sandboxYoutubeResults
                                .filter((_, idx) => selectedSandboxYoutube.has(idx))
                                .map(v => ({
                                  id: `yt_${Math.random().toString(36).substring(2, 11)}`,
                                  title: v.title.replace(/\[.*?\]|\(.*?\)/g, "").trim(),
                                  artist: v.author && v.author !== 'Various Artists' ? v.author : (selectedSandboxMalItem?.title || 'Various'),
                                  animeName: selectedSandboxMalItem?.title || 'Unknown',
                                  animePart: selectedSandboxMalItem?.year ? `Season 1 (${selectedSandboxMalItem.year})` : 'Season 1',
                                  type: 'OST' as TrackType,
                                  customImageUrl: selectedSandboxMalItem?.images?.jpg?.large_image_url || selectedSandboxMalItem?.images?.jpg?.image_url || '',
                                  youtubeId: v.videoId || "",
                                  elo: 1200,
                                  matchesPlayed: 0,
                                  wins: 0,
                                  losses: 0,
                                  draws: 0,
                                  tags: ['Official', 'Soundtrack']
                                }));

                              if (toImport.length === 0) {
                                toast.error('No soundtrack items are currently chosen to integrate.');
                                return;
                              }

                              try {
                                const count = await onBulkAddTracks(toImport);
                                toast.success(`Acquired ${count} soundtrack tracks successfully into core database!`);
                                setSandboxYoutubeResults([]);
                                setSandboxYoutubePlaylists([]);
                                if (currentCampaignIndex !== -1) {
                                  advanceCampaign();
                                }
                              } catch (e: any) {
                                toast.error(e.message);
                              }
                            }}
                            className="bg-moss hover:bg-moss/80 text-black px-3 py-1 rounded text-[11px] font-black uppercase tracking-widest transition-all cursor-pointer shadow"
                          >
                            🚀 Import {selectedSandboxYoutube.size} Tracks
                          </button>
                        </div>

                        {/* Interactive Selection Helpers Row */}
                        <div className="flex flex-wrap items-center gap-1 bg-zinc-950 p-1.5 rounded-lg border border-zinc-900/60 text-[11px] font-mono justify-between text-zinc-400">
                          <span className="uppercase font-bold text-zinc-500 pl-1">Helpers:</span>
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                const allIndices = new Set<number>(sandboxYoutubeResults.map((_, idx) => idx));
                                setSelectedSandboxYoutube(allIndices);
                                toast.success("Selected all items!");
                              }}
                              className="px-2 py-0.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded hover:text-white transition-colors cursor-pointer uppercase font-black"
                            >
                              Check All
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedSandboxYoutube(new Set());
                                toast.info("Unchecked all items!");
                              }}
                              className="px-2 py-0.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded hover:text-white transition-colors cursor-pointer uppercase font-black"
                            >
                              Uncheck All
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const ostOnly = new Set<number>();
                                sandboxYoutubeResults.forEach((v, idx) => {
                                  if (!isOpeningOrEnding(v.title)) {
                                    ostOnly.add(idx);
                                  }
                                });
                                setSelectedSandboxYoutube(ostOnly);
                                toast.success("Deselected OP/ED themes!");
                              }}
                              className="px-2 py-0.5 bg-rose-deep/30 hover:bg-rose-deep/60 border border-rose-deep/20 text-vermillion rounded hover:text-vermillion-tint transition-colors cursor-pointer uppercase font-bold"
                            >
                              Exclude OP/EDs
                            </button>
                          </div>
                        </div>

                        <div className="max-h-52 overflow-y-auto space-y-1 scrollbar-thin scrollbar-thumb-zinc-800 pr-1">
                          {sandboxYoutubeResults.map((v, i) => {
                            const isTheme = isOpeningOrEnding(v.title);
                            return (
                              <div 
                                key={i}
                                className={`p-1.5 px-2 border rounded flex items-center justify-between transition-colors text-[11px] ${
                                  isTheme 
                                    ? 'border-rose-deep bg-rose-deep/10 text-zinc-500' 
                                    : 'border-zinc-900 bg-zinc-950 hover:bg-zinc-900 text-zinc-300'
                                }`}
                              >
                                <label className="flex items-center gap-2 cursor-pointer flex-1 truncate max-w-[200px] xl:max-w-[240px]">
                                  <input 
                                    type="checkbox"
                                    checked={selectedSandboxYoutube.has(i)}
                                    onChange={() => {
                                      setSelectedSandboxYoutube(prev => {
                                        const next = new Set(prev);
                                        if (next.has(i)) next.delete(i);
                                        else next.add(i);
                                        return next;
                                      });
                                    }}
                                    className="accent-vermillion bg-[#16171a] border border-zinc-900 cursor-pointer h-3 w-3 shrink-0"
                                  />
                                  {v.videoId && (
                                    <img 
                                      src={`https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`} 
                                      alt="" 
                                      className="w-11 h-6.5 object-cover rounded bg-zinc-900 border border-zinc-800 shrink-0 shadow-sm"
                                      referrerPolicy="no-referrer"
                                    />
                                  )}
                                  <span className={`font-bold font-sans truncate ${isTheme ? 'line-through text-zinc-600 decoration-rose-deep/40' : 'text-zinc-200'}`}>
                                    {v.title}
                                  </span>
                                </label>
                                <div className="flex items-center gap-1.5 shrink-0 ml-1">
                                  {isTheme && (
                                    <span className="text-[6.5px] px-1 py-0.5 bg-rose-deep/60 text-vermillion border border-rose-deep/30 font-mono font-bold uppercase rounded scale-[0.9]">
                                      Theme Excluded
                                    </span>
                                  )}
                                  <span className="text-[11px] font-mono text-zinc-500 uppercase">{v.duration || "N/A"}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                  </div>
                </div>
              )}

            </div>



            {/* Sandbox manual insertion form */}
            <div className="bg-[#111215] border border-zinc-900/60 p-5 rounded-xl space-y-3.5">
              <div>
                <h3 className="text-white text-xs uppercase font-mono tracking-widest flex items-center gap-1.5 font-black">
                  <Plus className="w-4 h-4 text-moss" /> Theme Insertion Console
                </h3>
                <p className="text-zinc-500 text-[11px] font-mono mt-0.5 uppercase">// Integrate customized track specs manually</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-mono text-zinc-500 uppercase">Theme Title*</label>
                  <input
                    type="text"
                    placeholder="e.g. Unravel, Guren no Yumiya"
                    value={manualTitle}
                    onChange={(e) => setManualTitle(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-900 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-moss/50"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-mono text-zinc-500 uppercase">Performing Artist</label>
                  <input
                    type="text"
                    placeholder="e.g. TK from Ling Tosite Sigure"
                    value={manualArtist}
                    onChange={(e) => setManualArtist(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-900 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-moss/50"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-mono text-zinc-500 uppercase">Anime Name Reference*</label>
                  <input
                    type="text"
                    placeholder="e.g. Tokyo Ghoul"
                    value={manualAnimeName}
                    onChange={(e) => setManualAnimeName(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-900 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-moss/50"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-mono text-zinc-500 uppercase">Theme Type</label>
                  <select
                    value={manualType}
                    onChange={(e) => setManualType(e.target.value as TrackType)}
                    className="w-full bg-zinc-950 border border-zinc-900 rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 focus:outline-none focus:text-white"
                  >
                    <option value="OP">OP (Opening Theme)</option>
                    <option value="ED">ED (Ending Theme)</option>
                    <option value="OST">OST (Soundtrack / BGM)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-mono text-zinc-500 uppercase">MAL Series Part / Details</label>
                  <input
                    type="text"
                    placeholder="e.g. Season 1 (2014)"
                    value={manualAnimePart}
                    onChange={(e) => setManualAnimePart(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-900 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-moss/50"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-mono text-zinc-500 uppercase">YouTube video watch ID</label>
                  <input
                    type="text"
                    placeholder="e.g. uMeR_T0HsmQ"
                    value={manualYtId}
                    onChange={(e) => setManualYtId(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-900 rounded-lg px-2.5 py-1.5 text-xs font-mono text-zinc-300 focus:outline-none focus:border-moss/50"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-mono text-zinc-500 uppercase">Custom Cover artwork URL</label>
                <input
                  type="text"
                  placeholder="https://image-source-domain.com/art.jpg"
                  value={manualCover}
                  onChange={(e) => setManualCover(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-900 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-moss/50"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-mono text-zinc-500 uppercase">Generic descriptors / Tags (Comma splitted)</label>
                <input
                  type="text"
                  placeholder="e.g. Hype, Vocal, Heavy Rock"
                  value={manualTagsText}
                  onChange={(e) => setManualTagsText(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-900 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-moss/50"
                />
              </div>

              <button
                onClick={handleInsertManual}
                disabled={isInsertingManual}
                className="w-full py-2.5 bg-moss hover:bg-moss/80 text-black text-xs font-mono font-black uppercase tracking-wider rounded-lg transition-colors flex justify-center items-center gap-1.5 cursor-pointer"
              >
                {isInsertingManual ? <Loader2 className="w-4 h-4 animate-spin text-black" /> : <Plus className="w-4 h-4 text-black" />}
                Integrate New Theme into active DB
              </button>

            </div>

          </div>
          </motion.div>
        )}

        {activeTab === 'artists' && (
          <motion.div
            key="artists"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            {/* Header and Bulk Actions */}
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-[#111215] border border-zinc-900/60 p-5 rounded-xl">
              <div>
                <h3 className="text-white text-sm uppercase font-mono tracking-widest flex items-center gap-1.5 font-black">
                  <User className="w-5 h-5 text-vermillion" /> Artist Profiles Curator
                </h3>
                <p className="text-zinc-500 text-[11px] font-mono mt-0.5 uppercase">// Configure custom avatars, biographies, birthdays, and websites for database musicians</p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={async () => {
                    setIsBatchArtistCrawling(true);
                    setBatchLogs(prev => [...prev, `[INIT] Automated Artist Image & Info crawler starting...`]);
                    const uniqueArtists = Array.from(new Set(tracks.map(t => t.artist))).filter(Boolean);
                    setBatchLogs(prev => [...prev, `[PROCESS] Discovered ${uniqueArtists.length} unique artists inside active track catalogue.`]);
                    
                    let newlyHarvested = 0;
                    for (let i = 0; i < uniqueArtists.length; i++) {
                      const artistName = uniqueArtists[i];
                      const normalizedId = artistName.toLowerCase().trim();
                      const cached = artistProfiles.find(p => p.id === normalizedId);
                      if (cached && cached.imageUrl) {
                        continue; // already has photo, skip
                      }

                      setBatchLogs(prev => [...prev, `[HARVESTING] (${i+1}/${uniqueArtists.length}) Smart looking-up for "${artistName}"...`]);
                      try {
                        const res = await apiFetch(`/api/artist-image?artist=${encodeURIComponent(artistName)}`);
                        if (res.ok) {
                          const data = await res.json();
                          if (data && (data.imageUrl || data.bio)) {
                            await saveArtistProfile(artistName, {
                              imageUrl: data.imageUrl || undefined,
                              bio: data.bio || undefined,
                              birthday: data.birthday || undefined,
                              websiteUrl: data.websiteUrl || undefined,
                              malUrl: data.malUrl || undefined
                            });
                            newlyHarvested++;
                            setBatchLogs(prev => [...prev, `[SUCCESS] Captured & Saved details for "${artistName}".`]);
                          } else {
                            setBatchLogs(prev => [...prev, `[FAIL] No signals parsed for "${artistName}".`]);
                          }
                        }
                      } catch (err: any) {
                        setBatchLogs(prev => [...prev, `[ERROR] Scraper failed on "${artistName}": ${err.message}`]);
                      }
                      await new Promise(r => setTimeout(r, 600)); // anti-rate limit
                    }
                    setIsBatchArtistCrawling(false);
                    toast.success(`Artist Profiles Harvest completed! Crawled ${newlyHarvested} new profiles.`);
                  }}
                  disabled={isBatchArtistCrawling}
                  className="px-3.5 py-1.5 bg-vermillion/10 hover:bg-vermillion text-vermillion border border-vermillion/20 hover:border-vermillion text-[11px] font-mono font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer disabled:opacity-40"
                >
                  {isBatchArtistCrawling ? "Harvesting profiles..." : "Auto-Harvest Missing Artist Media"}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Left Column: Artists list */}
              <div className="lg:col-span-2 bg-[#111215] border border-zinc-900/60 p-5 rounded-xl space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] font-mono font-black uppercase text-zinc-400">// Dynamic Artists Index ({Array.from(new Set(tracks.map(t => t.artist))).filter(Boolean).length} performers)</span>
                  <input
                    type="text"
                    placeholder="Filter by artist name..."
                    value={artistSearch}
                    onChange={(e) => setArtistSearch(e.target.value)}
                    className="bg-zinc-950 border border-zinc-900 w-52 rounded-lg px-2.5 py-1 text-[11px] font-mono text-zinc-300 focus:outline-none focus:border-vermillion/50"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 max-h-[500px] overflow-y-auto pr-1">
                  {(() => {
                    const uniqueArtistsList = Array.from(new Set(tracks.map(t => t.artist)))
                      .filter(Boolean)
                      .filter(name => name.toLowerCase().includes(artistSearch.toLowerCase()));

                    if (uniqueArtistsList.length === 0) {
                      return (
                        <div className="col-span-2 text-center py-12 text-zinc-500 font-mono text-xs uppercase">
                          No matching artists located in the catalog.
                        </div>
                      );
                    }

                    return uniqueArtistsList.map((artistName) => {
                      const normalizedId = artistName.toLowerCase().trim();
                      const profile = artistProfiles.find(p => p.id === normalizedId);
                      
                      return (
                        <div
                          key={artistName}
                          onClick={() => {
                            setEditingArtist(artistName);
                            setArtistEditorName(artistName);
                            setArtistEditorImage(profile?.imageUrl || '');
                            setArtistEditorBio(profile?.bio || '');
                            setArtistEditorBirthday(profile?.birthday || '');
                            setArtistEditorWebsite(profile?.websiteUrl || '');
                            setArtistEditorMal(profile?.malUrl || '');
                          }}
                          className={`p-3 bg-[#221B13] hover:bg-zinc-950/60 border rounded-xl flex gap-3.5 items-center cursor-pointer transition-all ${
                            editingArtist === artistName 
                              ? 'border-vermillion/50 shadow-[0_0_15px_rgba(200, 30, 85,0.08)] bg-vermillion/5' 
                              : 'border-zinc-900 hover:border-zinc-800'
                          }`}
                        >
                          {/* Image preview */}
                          <div className="w-11 h-11 bg-zinc-900 border border-zinc-800 rounded-full shrink-0 overflow-hidden flex items-center justify-center">
                            {profile?.imageUrl ? (
                              <img src={profile.imageUrl} alt={artistName} className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-zinc-600 font-black uppercase text-xs font-display">{artistName.slice(0, 2)}</span>
                            )}
                          </div>
                          
                          <div className="min-w-0 flex-1">
                            <h4 className="font-bold text-white text-[12px] uppercase truncate" title={artistName}>{artistName}</h4>
                            <p className="text-[11px] font-mono mt-0.5 flex gap-2 items-center select-none uppercase">
                              {profile?.imageUrl ? (
                                <span className="text-moss font-extrabold flex items-center gap-0.5">✓ PHOTO LINKED</span>
                              ) : (
                                <span className="text-zinc-600 font-extrabold flex items-center gap-0.5">⚠ NO AVATAR</span>
                              )}
                              <span className="text-zinc-700 font-black">•</span>
                              <span className="text-vermillion font-bold">{tracks.filter(t => t.artist === artistName).length} themes</span>
                            </p>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

              {/* Right Column: Direct Editor Panel */}
              <div className="bg-[#111215] border border-zinc-900/60 p-5 rounded-xl space-y-4">
                {editingArtist ? (
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-white font-mono text-xs font-bold uppercase tracking-wide flex items-center gap-1.5">
                        <Edit className="w-4 h-4 text-moss" /> Edit Performer's Metadata
                      </h4>
                      <p className="text-zinc-500 text-[11px] font-mono uppercase mt-0.5">// Curating stats for: {editingArtist}</p>
                    </div>

                    <div className="space-y-3">
                      <div className="space-y-1">
                        <label className="text-[11px] font-mono text-zinc-500 uppercase">Artist Display Name*</label>
                        <input
                          type="text"
                          value={artistEditorName}
                          onChange={(e) => setArtistEditorName(e.target.value)}
                          className="w-full bg-zinc-950 border border-zinc-900 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-vermillion/50"
                        />
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between items-center">
                          <label className="text-[11px] font-mono text-zinc-500 uppercase">Profile Image URL</label>
                          <button
                            type="button"
                            onClick={async () => {
                              setIsSuggestingArtistImage(true);
                              try {
                                const res = await apiFetch(`/api/artist-image?artist=${encodeURIComponent(artistEditorName)}`);
                                if (res.ok) {
                                  const data = await res.json();
                                  if (data && data.imageUrl) {
                                    setArtistEditorImage(data.imageUrl);
                                    if (data.bio) setArtistEditorBio(data.bio);
                                    if (data.birthday) setArtistEditorBirthday(data.birthday);
                                    if (data.websiteUrl) setArtistEditorWebsite(data.websiteUrl);
                                    if (data.malUrl) setArtistEditorMal(data.malUrl);
                                    toast.success("Successfully harvested smart fields!");
                                  } else {
                                    toast.info("No profile artwork discovered on remote servers.");
                                  }
                                }
                              } catch (e) {
                                toast.error("Error connecting with smart harvesting endpoint.");
                              } finally {
                                setIsSuggestingArtistImage(false);
                              }
                            }}
                            disabled={isSuggestingArtistImage}
                            className="text-[11px] font-mono font-black text-vermillion hover:text-vermillion-tint uppercase cursor-pointer"
                          >
                            {isSuggestingArtistImage ? "Crawling Jikan/iTunes..." : "[Auto-Harvest Suggestion]"}
                          </button>
                        </div>
                        <input
                          type="text"
                          value={artistEditorImage}
                          onChange={(e) => setArtistEditorImage(e.target.value)}
                          placeholder="https://images.myanimelist.net/...jpg"
                          className="w-full bg-zinc-950 border border-zinc-900 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-vermillion/50"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-[11px] font-mono text-zinc-500 uppercase">Birthday (YYYY-MM-DD)</label>
                          <input
                            type="text"
                            value={artistEditorBirthday}
                            onChange={(e) => setArtistEditorBirthday(e.target.value)}
                            placeholder="e.g. 1990-07-09"
                            className="w-full bg-zinc-950 border border-zinc-900 rounded-lg px-2.5 py-1.5 text-xs font-mono text-zinc-300 focus:outline-none focus:border-vermillion/50"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] font-mono text-zinc-500 uppercase">Official Website URL</label>
                          <input
                            type="text"
                            value={artistEditorWebsite}
                            onChange={(e) => setArtistEditorWebsite(e.target.value)}
                            placeholder="https://www.aimer-web.jp/"
                            className="w-full bg-zinc-950 border border-zinc-900 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-vermillion/50"
                          />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] font-mono text-zinc-500 uppercase">MyAnimeList Person URL</label>
                        <input
                          type="text"
                          value={artistEditorMal}
                          onChange={(e) => setArtistEditorMal(e.target.value)}
                          placeholder="https://myanimelist.net/people/..."
                          className="w-full bg-zinc-950 border border-zinc-900 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] font-mono text-zinc-500 uppercase">Biography / Profile Summary</label>
                        <textarea
                          rows={4}
                          value={artistEditorBio}
                          onChange={(e) => setArtistEditorBio(e.target.value)}
                          placeholder="Write something detailed about the biography of this artist..."
                          className="w-full bg-zinc-950 border border-zinc-900 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-vermillion/50"
                        />
                      </div>

                      <div className="flex gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setEditingArtist(null)}
                          className="flex-1 py-2 bg-zinc-950 hover:bg-zinc-900 border border-zinc-900 hover:border-zinc-800 rounded-lg text-[11px] font-mono font-black text-zinc-400 uppercase transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!artistEditorName.trim()) {
                              toast.error("Name is required!");
                              return;
                            }
                            setIsSavingArtist(true);
                            try {
                              await saveArtistProfile(editingArtist, {
                                imageUrl: artistEditorImage.trim() || undefined,
                                bio: artistEditorBio.trim() || undefined,
                                birthday: artistEditorBirthday.trim() || undefined,
                                websiteUrl: artistEditorWebsite.trim() || undefined,
                                malUrl: artistEditorMal.trim() || undefined
                              });
                              toast.success(`Artist profile "${artistEditorName}" successfully updated in Firestore!`);
                              setEditingArtist(null);
                            } catch (e: any) {
                              toast.error(`Update failed: ${e.message}`);
                            } finally {
                              setIsSavingArtist(false);
                            }
                          }}
                          disabled={isSavingArtist}
                          className="flex-1 py-2 bg-vermillion hover:bg-vermillion-hover text-black rounded-lg text-[11px] font-mono font-black uppercase transition-all cursor-pointer flex justify-center items-center gap-1.5"
                        >
                          {isSavingArtist && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                          Save Changes
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 text-zinc-500 font-mono text-xs uppercase flex flex-col justify-center items-center h-full">
                    <User className="w-8 h-8 text-zinc-800 mb-2" />
                    <span>Select an artist performer on the left catalog to curate customized images and details.</span>
                  </div>
                )}
              </div>

            </div>

            {/* Diagnostic Logs terminal feed at bottom of tab */}
            <div className="space-y-2 pt-2.5">
              <span className="text-[11px] font-mono text-zinc-500 uppercase flex items-center gap-1.5">
                <Code className="w-3.5 h-3.5" /> Core SRE execution monitor stream:
              </span>

              {isBatchArtistCrawling && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[11px] font-mono uppercase text-zinc-400">
                    <span>Task progress:</span>
                    <span>System Harvesting Artist profiles...</span>
                  </div>
                  <div className="w-full h-1 bg-zinc-950 border border-zinc-900 rounded-full overflow-hidden">
                    <motion.div 
                      className="h-full bg-vermillion"
                      initial={{ width: 0 }}
                      animate={{ width: "100%" }}
                      transition={{ repeat: Infinity, duration: 2, ease: "linear", repeatType: "mirror" }}
                    />
                  </div>
                </div>
              )}

              <div className="bg-black/95 rounded-xl border border-zinc-900 p-3.5 h-44 overflow-y-auto font-mono text-[11px] text-[#A0AABA] space-y-1.5 scroll-smooth shadow-inner">
                {batchLogs.length === 0 ? (
                  <div className="h-full w-full flex items-center justify-center opacity-30 select-none">// Awaiting search/crawler parameters...</div>
                ) : (
                  batchLogs.map((log, i) => (
                    <div key={i} className={`
                      ${log.includes('[SUCCESS]') ? 'text-moss' : ''}
                      ${log.includes('[FAIL]') ? 'text-gold' : ''}
                      ${log.includes('[ERROR]') ? 'text-vermillion' : ''}
                      ${log.includes('[INIT]') ? 'text-gold-bright font-black' : ''}
                      ${log.includes('[HARVESTING]') ? 'text-vermillion' : ''}
                      ${log.includes('[COMPLETE]') ? 'text-vermillion font-black' : ''}
                    `}>
                      &gt; {log}
                    </div>
                  ))
                )}
                <div ref={logsEndRef} />
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'pokedex' && (
          <motion.div
            key='pokedex'
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <AdminPokedex allTracks={tracks} />
          </motion.div>
        )}

        {activeTab === 'ui-lab' && (
          <motion.div
            key="ui-lab"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            {/* Header and Brand Panel */}
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-[#111215] border border-zinc-900/60 p-5 rounded-xl">
              <div>
                <h3 className="text-white text-sm uppercase font-mono tracking-widest flex items-center gap-1.5 font-black">
                  <Camera className="w-5 h-5 text-vermillion" /> UI State-Combination lab
                </h3>
                <p className="text-zinc-500 text-[11px] font-mono mt-0.5 uppercase">
                  // Automated programmatic view cycles, layout stabilizers, and batch high-dpi screenshot exporters
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={runAutomatedCaptureSequence}
                  disabled={isCapturing}
                  className="px-4 py-2 bg-vermillion hover:bg-vermillion-hover disabled:opacity-40 text-black text-xs font-mono font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer flex items-center gap-1.5"
                >
                  {isCapturing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Capturing [{currentCaptureIndex + 1}/{selectedCombinations.length}]...
                    </>
                  ) : (
                    <>
                      <Camera className="w-3.5 h-3.5 text-black" />
                      Start Screenshot Tour
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Split layout block */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Left column: Setup controls */}
              <div className="lg:col-span-2 bg-[#111215] border border-zinc-900/60 p-5 rounded-xl space-y-5">
                <div>
                  <h4 className="text-xs font-mono font-black text-white uppercase tracking-wider mb-3">
                    1. Choose UI States to Simulate
                  </h4>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {[
                      { id: 'leaderboard', label: 'Leaderboard Home', desc: 'Main home feed leaderboard list' },
                      { id: 'arena', label: 'Endless 1v1 Arena', desc: 'Anime theme voting matchup portal' },
                      { id: 'tournament', label: 'Championship Bracket', desc: 'Interactive championship brackets' },
                      { id: 'search', label: 'Track Explorer Engine', desc: 'Database searching and filters' },
                      { id: 'artist_wiki', label: 'Artist Biography Wiki', desc: 'Curator biography modal deck (LiSA)' },
                      { id: 'anime_wiki', label: 'Franchise Music Wiki', desc: 'Anime themes wiki list (Evangelion)' },
                      { id: 'player_active', label: 'Expanded Footer Player', desc: 'Global media player expanded console' },
                      { id: 'submissions', label: 'Suggestions Inlet', desc: 'Themes inbox submission form' },
                      { id: 'admin_dashboard', label: 'Moderation Workspace', desc: 'Admin SRE dashboard moderation center' },
                      { id: 'onboarding_step0', label: 'Onboarding Welcome Screen', desc: 'Introduction slide 1 tutorial overlay' },
                      { id: 'onboarding_step1', label: 'Onboarding Arena Tour', desc: 'Endless arena slide 2 tutorial overlay' },
                      { id: 'login_modal', label: 'Login Authentication Modal', desc: 'User sign-in verification sub-panel capture' },
                      { id: 'user_profile_tab', label: 'User Hub Settings', desc: 'Personal metrics and playlist profile view' },
                      { id: 'profile_overlay', label: 'Community Profile Modal', desc: 'External user public stats popup card capture' },
                      { id: 'tourney_builder', label: 'Tournament Creator', desc: 'Custom private bracket builder workshop' },
                      { id: 'track_preview', label: 'Track Preview Row Card', desc: 'Leaderboard isolated track item partial capture' },
                      { id: 'clash_panel', label: 'Clash of the Day Panel', desc: 'Daily hand-picked track clash card widget' },
                      { id: 'playlists_tab', label: 'User Playlists Discovery', desc: 'Community curated playlists browse feed' },
                      { id: 'search_filters', label: 'Expanded Search Filters', desc: 'Database tags and sorting options' }
                    ].map((item) => {
                      const active = selectedCombinations.includes(item.id);
                      return (
                        <div 
                          key={item.id}
                          onClick={() => {
                            if (isCapturing) return;
                            setSelectedCombinations(prev => 
                              prev.includes(item.id) 
                                ? prev.filter(x => x !== item.id) 
                                : [...prev, item.id]
                            );
                          }}
                          className={`p-3 rounded-lg border text-left cursor-pointer transition-all select-none ${
                            active 
                              ? 'bg-vermillion/5 border-vermillion/25' 
                              : 'bg-zinc-950 border-zinc-900 hover:border-zinc-800'
                          }`}
                        >
                          <div className="flex items-start gap-2.5">
                            <input 
                              type="checkbox" 
                              checked={active}
                              disabled={isCapturing}
                              onChange={() => {}} // Handle inside click parent
                              className="mt-1 accent-vermillion cursor-pointer"
                            />
                            <div className="flex-1 min-w-0">
                              <p className={`text-xs font-black uppercase font-mono tracking-wide ${active ? 'text-vermillion' : 'text-zinc-300'}`}>
                                {item.label}
                              </p>
                              <p className="text-[11px] text-zinc-500 font-mono mt-0.5 leading-snug">
                                {item.desc}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <hr className="border-[#1e1e24]/30" />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-xs font-mono font-black text-white uppercase tracking-wider mb-2">
                      2. Layout Stabilizer Delay
                    </h4>
                    <span className="text-[11px] font-mono text-zinc-500 uppercase block mb-2 leading-none">
                      // Waiting period between state cycles for images to render
                    </span>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min="200"
                        max="3000"
                        step="100"
                        value={screenshotDelay}
                        disabled={isCapturing}
                        onChange={(e) => setScreenshotDelay(Number(e.target.value))}
                        className="flex-1 accent-vermillion h-1 bg-zinc-950 rounded-lg cursor-pointer"
                      />
                      <span className="px-2.5 py-1 bg-zinc-950 border border-zinc-900 rounded font-mono text-[11px] text-vermillion font-bold min-w-[70px] text-center">
                        {screenshotDelay} ms
                      </span>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-mono font-black text-white uppercase tracking-wider mb-2">
                      3. Screen Shot Engine Options
                    </h4>
                    <span className="text-[11px] font-mono text-zinc-500 uppercase block mb-2 leading-none">
                      // Select capture parser engine algorithm
                    </span>
                    <div className="flex gap-2">
                      {[
                        { id: 'html2canvas', name: 'html2canvas (DOM Canvas)', desc: 'High compatibility rasterizer' },
                        { id: 'html-to-image', name: 'html-to-image (SVG Link)', desc: 'Vector precise asset converter' }
                      ].map((eng) => (
                        <button
                          key={eng.id}
                          onClick={() => setScreenshotEngine(eng.id as any)}
                          disabled={isCapturing}
                          className={`flex-1 p-2.5 rounded-lg border text-left cursor-pointer transition-all ${
                            screenshotEngine === eng.id
                              ? 'bg-zinc-900 border-zinc-800 text-white'
                              : 'bg-zinc-950 border-zinc-900 hover:border-zinc-800 text-zinc-500 hover:text-zinc-400'
                          }`}
                        >
                          <p className="text-[11px] font-mono font-black uppercase leading-tight">{eng.name}</p>
                          <p className="text-[11px] text-zinc-500 font-mono mt-0.5 leading-tight">{eng.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

              </div>
              
              {/* Right column: logs console */}
              <div className="bg-[#111215] border border-zinc-900/60 p-5 rounded-xl flex flex-col justify-between h-full min-h-[350px]">
                <div className="space-y-4 flex-1">
                  <div>
                    <h4 className="text-xs font-mono font-black text-white uppercase tracking-wider mb-1.5 flex items-center gap-1">
                      <LayoutTemplate className="w-4 h-4 text-vermillion" /> SRE Automation logs
                    </h4>
                    <p className="text-zinc-500 text-[11px] font-mono uppercase leading-none">// Active state cycler telemetry stream</p>
                  </div>

                  {isCapturing && (
                    <div className="space-y-1 pt-1">
                      <div className="flex justify-between text-[11px] text-zinc-400 font-mono uppercase">
                        <span>TOUR PROGRESS:</span>
                        <span>{Math.round(((currentCaptureIndex + 1) / selectedCombinations.length) * 100)}%</span>
                      </div>
                      <div className="w-full h-1 bg-zinc-950 border border-zinc-900 rounded-full overflow-hidden">
                        <motion.div 
                          className="h-full bg-vermillion"
                          animate={{ width: `${((currentCaptureIndex + 1) / selectedCombinations.length) * 100}%` }}
                          transition={{ duration: 0.3 }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="bg-black/95 rounded-xl border border-zinc-900 p-3.5 h-[230px] overflow-y-auto font-mono text-[11px] text-[#A0AABA] space-y-1.5 shadow-inner">
                    {labLogs.map((log, i) => (
                      <div key={i} className={`
                        ${log.includes('[SUCCESS]') ? 'text-moss' : ''}
                        ${log.includes('[FAIL]') ? 'text-gold' : ''}
                        ${log.includes('[ERROR]') ? 'text-vermillion' : ''}
                        ${log.includes('[INIT]') ? 'text-gold-bright font-black' : ''}
                        ${log.includes('[SCREENSHOT]') ? 'text-vermillion' : ''}
                        ${log.includes('[COMPLETE]') ? 'text-vermillion font-black' : ''}
                      `}>
                        &gt; {log}
                      </div>
                    ))}
                    <div ref={logsEndRef} />
                  </div>
                </div>

                <div className="pt-4 border-t border-zinc-900/60 mt-auto">
                  <button
                    onClick={runAutomatedCaptureSequence}
                    disabled={isCapturing}
                    className="w-full py-2.5 bg-zinc-950 text-vermillion border border-vermillion/15 hover:bg-vermillion hover:text-black font-mono text-[11px] font-bold uppercase transition-all rounded-lg cursor-pointer flex justify-center items-center gap-1.5"
                  >
                    <Camera className="w-4 h-4 shrink-0" />
                    {isCapturing ? 'Automated Tour Active...' : 'Launch Automated Capture'}
                  </button>
                </div>
              </div>

            </div>

            {/* Screenshots Capture gallery display board */}
            <div className="bg-[#111215] border border-zinc-900/60 p-5 rounded-xl space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                  <h3 className="text-white text-xs uppercase font-mono tracking-widest flex items-center gap-1.5 font-bold">
                    <LayoutTemplate className="w-4 h-4 text-vermillion" /> Active Screenshots board
                  </h3>
                  <p className="text-zinc-500 text-[11px] font-mono mt-0.5 uppercase">// Captured frames available for browser download ({capturedImages.length} images)</p>
                </div>

                {capturedImages.length > 0 && (
                  <button
                    onClick={downloadAllCapturedImages}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-brand-primary/10 hover:bg-brand-primary text-brand-primary hover:text-black border border-brand-primary/20 hover:border-brand-primary rounded font-mono text-[11px] uppercase font-black cursor-pointer transition-all"
                  >
                    <Download className="w-3.5 h-3.5" /> Download All Snapshots
                  </button>
                )}
              </div>

              {capturedImages.length === 0 ? (
                <div className="flex flex-col justify-center items-center py-12 border border-dashed border-zinc-900 bg-zinc-950/20 rounded-xl space-y-2">
                  <Camera className="w-9 h-9 text-zinc-800" />
                  <p className="font-mono text-zinc-500 text-xs">No captured frames generated in this session yet.</p>
                  <p className="font-mono text-zinc-700 text-[11px] uppercase">Click "Start Screenshot Tour" above to trigger layout state automation</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {capturedImages.map((img) => (
                    <motion.div 
                      key={img.id}
                      className="bg-[#221B13] border border-zinc-900 rounded-lg p-3 space-y-3 shadow-md hover:border-zinc-800 transition-colors group"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                    >
                      {/* Image Viewer Container */}
                      <div className="relative aspect-video rounded-md overflow-hidden bg-zinc-950 border border-zinc-900">
                        <img 
                          src={img.dataUrl} 
                          alt={img.name} 
                          className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-300" 
                          referrerPolicy="no-referrer"
                        />
                        
                        {/* Hover Overlay triggers individual download */}
                        <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                          <button
                            onClick={() => downloadSingleCapturedImage(img)}
                            className="p-2 bg-vermillion rounded-full text-black hover:bg-vermillion-hover transition-colors cursor-pointer"
                            title="Download frame PNG"
                          >
                            <Download className="w-4 h-4 text-black block" />
                          </button>
                          
                          <button
                            onClick={() => {
                              const win = window.open();
                              if (win) {
                                win.document.write(`<iframe src="${img.dataUrl}" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>`);
                              } else {
                                toast.error("Pop-up blocker is active. Please allow popups to view high-dpi preview.");
                              }
                            }}
                            className="p-2 bg-zinc-900 border border-zinc-800 rounded-full text-zinc-400 hover:text-white transition-colors cursor-pointer"
                            title="Open in new window"
                          >
                            <ExternalLink className="w-4 h-4 block" />
                          </button>
                        </div>
                      </div>

                      {/* Details & Actions Footer */}
                      <div className="flex justify-between items-center bg-[#0A0805] px-2.5 py-2 border border-zinc-950 rounded-md">
                        <div className="truncate flex-1 pr-2">
                          <p className="font-mono text-[11px] text-zinc-100 font-black truncate">{img.name}.png</p>
                          <p className="font-mono text-[11px] text-zinc-600 uppercase">Size: ~{Math.round(img.dataUrl.length / 1024)} KB</p>
                        </div>
                        <button
                          onClick={() => downloadSingleCapturedImage(img)}
                          className="px-2 py-1 bg-zinc-950 border border-zinc-900 hover:border-zinc-800 text-zinc-400 hover:text-white font-mono text-[11px] uppercase rounded cursor-pointer transition-colors"
                        >
                          Download
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>

          </motion.div>
        )}

      </AnimatePresence>

      {/* Advanced diagnostics modals sweep UI */}
      <AnimatePresence>
        {showBatchModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-[#0A0805] border border-[#221B13] rounded-xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]"
            >
              <div className="p-4 border-b border-[#221B13] flex justify-between items-center bg-zinc-950">
                <h3 className="text-white font-mono font-bold text-sm uppercase tracking-wider flex items-center gap-2">
                  <Database className="w-4 h-4 text-vermillion" /> Administration System diagnostics
                </h3>
                {!(isBatchResolving || isTagging || isProcessingImages) && (
                  <button onClick={() => setShowBatchModal(false)} className="text-zinc-500 hover:text-white cursor-pointer p-1">
                    <XCircle className="w-5 h-5 block" />
                  </button>
                )}
              </div>

              <div className="p-5 flex-1 overflow-y-auto space-y-4">
                
                <div className="p-4 bg-zinc-950 border border-zinc-900 rounded-lg space-y-2">
                  <span className="text-[11px] font-mono text-zinc-500 uppercase block tracking-wider">// Active Database Metrics Diagnostics</span>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <p className="text-[11px] text-zinc-600 font-mono">HEALTH GRADE</p>
                      <p className={`text-xl font-black ${stats.gradeColor}`}>{stats.grade} ({stats.score}/100)</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-zinc-600 font-mono">TOTAL MODELS</p>
                      <p className="text-xl font-bold text-white">{stats.total}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-zinc-600 font-mono">CUSTOM ARTWORK</p>
                      <p className="text-xl font-bold text-white">{stats.coverRate}%</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-zinc-600 font-mono">MAL INDEXED</p>
                      <p className="text-xl font-bold text-white">{stats.alignmentRate}%</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <span className="text-[11px] font-mono text-zinc-500 uppercase flex items-center gap-1.5">
                    <Code className="w-3.5 h-3.5 text-vermillion" /> SRE Diagnostic Live stream
                  </span>
                  <div className="bg-black text-[#A0AABA] rounded-lg p-3 h-48 overflow-y-auto font-mono text-[11px] space-y-1">
                    {batchLogs.map((log, lIdx) => (
                      <div key={lIdx}>&gt; {log}</div>
                    ))}
                  </div>
                </div>

              </div>
              
              <div className="p-4 bg-zinc-950 border-t border-[#221B13] flex justify-end">
                <button
                  disabled={isBatchResolving || isTagging || isProcessingImages}
                  onClick={() => setShowBatchModal(false)}
                  className="px-4 py-2 border border-zinc-900 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg text-xs font-mono uppercase font-black cursor-pointer"
                >
                  Close panel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Track custom specs editor modal */}
      <AnimatePresence>
        {editingTrack && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-[#0A0805] border border-[#221B13] rounded-xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col"
            >
              <div className="p-4 border-b border-[#221B13] flex justify-between items-center bg-zinc-950">
                <h3 className="text-white font-mono font-bold text-xs uppercase tracking-wider flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-gold-bright" /> Edit theme Specifications
                </h3>
                <button onClick={() => setEditingTrack(null)} className="text-zinc-500 hover:text-white cursor-pointer p-1">
                  <XCircle className="w-5 h-5 block" />
                </button>
              </div>

              <div className="p-5 overflow-y-auto space-y-4 max-h-[70vh]">
                
                <div className="grid grid-cols-2 gap-3.5">
                  <div className="space-y-1">
                    <label className="text-[11px] font-mono text-zinc-500 uppercase">Track Title</label>
                    <input
                      type="text"
                      value={editorTitle}
                      onChange={(e) => setEditorTitle(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-900 rounded-lg px-2.5 py-1.5 text-xs text-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-mono text-zinc-500 uppercase">Artist Name</label>
                    <input
                      type="text"
                      value={editorArtist}
                      onChange={(e) => setEditorArtist(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-900 rounded-lg px-2.5 py-1.5 text-xs text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3.5">
                  <div className="space-y-1">
                    <label className="text-[11px] font-mono text-zinc-500 uppercase">Anime Series</label>
                    <input
                      type="text"
                      value={editorAnime}
                      onChange={(e) => setEditorAnime(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-900 rounded-lg px-2.5 py-1.5 text-xs text-white"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-mono text-zinc-500 uppercase">Theme Type</label>
                    <select
                      value={editorType}
                      onChange={(e) => setEditorType(e.target.value as TrackType)}
                      className="w-full bg-zinc-950 border border-zinc-900 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none"
                    >
                      <option value="OP">OP (Opening)</option>
                      <option value="ED">ED (Ending)</option>
                      <option value="OST">OST (Soundtrack / BGM)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3.5">
                  <div className="space-y-1">
                    <label className="text-[11px] font-mono text-zinc-500 uppercase">MAL Aligned Series Part</label>
                    <input
                      type="text"
                      value={editorPart}
                      onChange={(e) => setEditorPart(e.target.value)}
                      placeholder="e.g. Season 1 (2018)"
                      className="w-full bg-zinc-950 border border-zinc-900 rounded-lg px-2.5 py-1.5 text-xs text-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-mono text-zinc-500 uppercase">YouTube Video ID</label>
                    <input
                      type="text"
                      value={editorYtoolsId}
                      onChange={(e) => setEditorYtoolsId(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-900 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                    />
                  </div>
                </div>

                {/* Cover art URL & verification preview wrapper */}
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <label className="text-[11px] font-mono text-zinc-500 uppercase">Cover image URL</label>
                    <button
                      onClick={handleSuggestCoverDetails}
                      disabled={isSuggestingCover}
                      className="text-[11px] font-mono bg-gold/10 hover:bg-gold text-gold hover:text-black hover:font-black border border-gold/20 rounded px-1.5 py-0.5 cursor-pointer flex items-center gap-1"
                    >
                      {isSuggestingCover ? 'Searching...' : 'Suggest cover from iTunes'}
                    </button>
                  </div>
                  <div className="flex gap-2.5">
                    <input
                      type="text"
                      value={editorCover}
                      onChange={(e) => setEditorCover(e.target.value)}
                      placeholder="Enter premium cover image URL link"
                      className="flex-1 bg-zinc-950 border border-zinc-900 rounded-lg px-2.5 py-1.5 text-xs text-white truncate"
                    />
                    {editorCover && (
                      <div className="h-8.5 w-8.5 rounded bg-zinc-950 border border-zinc-900 overflow-hidden shrink-0">
                        <img src={editorCover} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Interactive Multi-tag creator cloud */}
                <div className="space-y-2">
                  <label className="text-[11px] font-mono text-zinc-500 uppercase block">Metadata Style tags</label>
                  
                  <div className="flex flex-wrap gap-1.5 p-2 bg-zinc-950 rounded-lg border border-zinc-900 min-h-12">
                    {editorTags.length === 0 ? (
                      <span className="text-[11px] font-mono text-zinc-500 self-center">// No tags mapped</span>
                    ) : (
                      editorTags.map(tag => (
                        <span 
                          key={tag} 
                          onClick={() => setEditorTags(prev => prev.filter(t => t !== tag))}
                          className="px-2 py-0.5 bg-indigo-ink/10 hover:bg-vermillion/10 text-gold-bright hover:text-vermillion hover:line-through border border-indigo-ink/10 cursor-pointer rounded text-[11px] font-mono uppercase"
                          title="Click to remove tag"
                        >
                          {tag} ×
                        </span>
                      ))
                    )}
                  </div>

                  {/* Suggest common tags pills */}
                  <div className="space-y-1 pt-1">
                    <span className="text-[11px] font-mono text-zinc-600 block uppercase">Click to add genre categories:</span>
                    <div className="flex flex-wrap gap-1">
                      {COMMON_TAGS.map(ct => (
                        <button
                          key={ct}
                          onClick={() => {
                            if (!editorTags.includes(ct)) {
                              setEditorTags(prev => [...prev, ct]);
                            }
                          }}
                          className={`px-1.5 py-0.5 rounded text-[11px] border transition-all cursor-pointer ${
                            editorTags.includes(ct) 
                              ? 'bg-vermillion border-vermillion-hover text-black' 
                              : 'bg-zinc-950 border-zinc-800 hover:border-zinc-700 text-zinc-500 hover:text-zinc-300'
                          }`}
                        >
                          + {ct}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

              </div>

              <div className="p-4 bg-zinc-950 border-t border-[#221B13] flex justify-between">
                <button
                  onClick={() => handleDeleteSingleTrack(editingTrack.id, editorTitle)}
                  className="px-4 py-2 border border-vermillion/10 hover:bg-vermillion text-vermillion hover:text-black font-black hover:font-black text-xs font-mono uppercase rounded-lg transition-colors cursor-pointer"
                >
                  Delete Track
                </button>

                <div className="flex gap-2">
                  <button
                    onClick={() => setEditingTrack(null)}
                    className="px-4 py-2 border border-zinc-900 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg text-xs font-mono uppercase font-black cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveTrackEdits}
                    disabled={isSavingTrack || !editorTitle.trim()}
                    className="px-4 py-2 bg-vermillion hover:bg-vermillion-hover text-black rounded-lg text-xs font-mono font-black uppercase flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    {isSavingTrack && <Loader2 className="w-4 h-4 animate-spin" />}
                    Save Config
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
