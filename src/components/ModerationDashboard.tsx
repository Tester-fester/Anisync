import React, { useState, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AnimeTrack, ContributionProposal, TrackType } from '../types';
import {
  CheckCircle, XCircle, Play, ExternalLink, RefreshCw, Image as ImageIcon,
  Youtube, Search, Loader2, ChevronLeft, ChevronRight, Check, AlertCircle,
  Tag, Link2, Music, Tv, Sparkles, Plus, Minus, Download, Filter,
  UserSearch, Wand2, Database, X, Fingerprint, Merge, ScanEye
} from '@/utils/icons';
import {
  normalizeName, describeDifference, findSimilar, clusterSimilar,
  type SimilarityGroup,
} from '../utils/stringSimilarity';
import { toast } from 'sonner';
import { apiFetch } from '../utils/apiFetch';
import { SONG_TAG_CATEGORIES } from '../utils/songTags';

// ---------------------------------------------------------------------------
// ModerationDashboard — visual admin tool for fast decisions.
//
// Features:
//   1. Proposal Queue — card-based review of user-submitted tracks
//   2. Link Comparison — side-by-side YouTube videos, pick the best one
//   3. Cover Art Picker — visual grid of cover art from iTunes/MusicBrainz
//   4. Bulk Tag Editor — apply tags to multiple tracks at once
//   5. Artist Lookup — auto-find missing artists (AnimeThemes→iTunes→MB)
// ---------------------------------------------------------------------------

interface ModerationDashboardProps {
  proposals: ContributionProposal[];
  tracks: AnimeTrack[];
  onApproveProposal: (proposal: ContributionProposal, trackData: Partial<AnimeTrack>) => void;
  onRejectProposal: (proposal: ContributionProposal) => void;
  onUpdateTrack: (trackId: string, updates: Partial<AnimeTrack>) => void;
  onBulkAddTracks?: (tracks: AnimeTrack[]) => Promise<number>;
}

type ModerationTab = 'smart-import' | 'proposals' | 'link-compare' | 'cover-art' | 'bulk-tag' | 'artist-lookup' | 'similarity';

export function ModerationDashboard({
  proposals,
  tracks,
  onApproveProposal,
  onRejectProposal,
  onUpdateTrack,
  onBulkAddTracks,
}: ModerationDashboardProps) {
  const [activeTab, setActiveTab] = useState<ModerationTab>('smart-import');

  const pendingProposals = proposals.filter(p => p.status === 'pending');

  // Count tracks with missing/Unknown artist so the tab badge shows the queue size.
  const unknownArtistCount = useMemo(
    () => tracks.filter(t => isUnknownArtist(t.artist)).length,
    [tracks],
  );

  return (
    <div className="space-y-4">
      {/* Tab Header */}
      <div className="flex items-center gap-2 p-1 bg-zinc-950 border border-zinc-800 rounded-xl overflow-x-auto [&::-webkit-scrollbar]:hidden">
        {([
          { id: 'smart-import', label: 'Smart Import', icon: Download, count: undefined },
          { id: 'proposals', label: 'Proposals', icon: CheckCircle, count: pendingProposals.length },
          { id: 'link-compare', label: 'Link Compare', icon: Link2, count: undefined },
          { id: 'cover-art', label: 'Cover Art', icon: ImageIcon, count: undefined },
          { id: 'bulk-tag', label: 'Bulk Tag', icon: Tag, count: undefined },
          { id: 'artist-lookup', label: 'Artist Lookup', icon: UserSearch, count: unknownArtistCount },
          { id: 'similarity', label: 'Similarity', icon: Fingerprint, count: undefined },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono font-black uppercase tracking-wider transition-all cursor-pointer shrink-0 ${
              activeTab === tab.id
                ? 'bg-zinc-800 text-white border border-zinc-700'
                : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            <span>{tab.label}</span>
            {tab.count !== undefined && tab.count > 0 && (
              <span className="bg-vermillion text-white text-[10px] px-1.5 py-0.5 rounded-full leading-none">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.15 }}
        >
          {activeTab === 'smart-import' && (
            <SmartImportTool onBulkAddTracks={onBulkAddTracks} />
          )}
          {activeTab === 'proposals' && (
            <ProposalQueue
              proposals={pendingProposals}
              onApprove={onApproveProposal}
              onReject={onRejectProposal}
            />
          )}
          {activeTab === 'link-compare' && (
            <LinkCompareTool tracks={tracks} onUpdateTrack={onUpdateTrack} />
          )}
          {activeTab === 'cover-art' && (
            <CoverArtPicker tracks={tracks} onUpdateTrack={onUpdateTrack} />
          )}
          {activeTab === 'bulk-tag' && (
            <BulkTagEditor tracks={tracks} onUpdateTrack={onUpdateTrack} />
          )}
          {activeTab === 'artist-lookup' && (
            <ArtistLookupTool tracks={tracks} onUpdateTrack={onUpdateTrack} />
          )}
          {activeTab === 'similarity' && (
            <SimilarityInvestigator tracks={tracks} onUpdateTrack={onUpdateTrack} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Artist Lookup helpers — shared with the server's isUnknownArtist check.
// We mirror the server's logic so the client can pre-filter tracks without
// a round-trip.
// ---------------------------------------------------------------------------

function isUnknownArtist(s: string | null | undefined): boolean {
  if (!s) return true;
  const v = s.trim().toLowerCase();
  return (
    v === '' ||
    v === 'unknown' ||
    v === 'unknown artist' ||
    v === 'unknown performer' ||
    v === 'various' ||
    v === 'various artists' ||
    v === 'n/a' ||
    v === 'original artist' ||
    v === 'soundtrack composer' ||
    v === 'original composer'
  );
}

// ===========================================================================
// 1. PROPOSAL QUEUE — card-based review of user-submitted tracks
// ===========================================================================

function ProposalQueue({
  proposals,
  onApprove,
  onReject,
}: {
  proposals: ContributionProposal[];
  onApprove: (p: ContributionProposal, trackData: Partial<AnimeTrack>) => void;
  onReject: (p: ContributionProposal) => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [youtubeSearchResults, setYoutubeSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);

  const current = proposals[currentIndex];

  if (proposals.length === 0) {
    return (
      <div className="bg-zinc-950 border border-zinc-900 rounded-xl p-8 text-center">
        <CheckCircle className="w-12 h-12 text-moss mx-auto mb-3" />
        <p className="text-zinc-400 text-sm">No pending proposals. You're all caught up!</p>
      </div>
    );
  }

  if (!current) {
    setCurrentIndex(0);
    return null;
  }

  const searchYoutube = async () => {
    if (!current.trackData.title) return;
    setSearching(true);
    setYoutubeSearchResults([]);
    setSelectedVideoId(null);
    try {
      const query = `${current.trackData.animeName} ${current.trackData.type} ${current.trackData.title} ${current.trackData.artist}`;
      const res = await apiFetch(`/api/youtube-search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setYoutubeSearchResults(data.videos || []);
    } catch (err: any) {
      toast.error('YouTube search failed: ' + err.message);
    } finally {
      setSearching(false);
    }
  };

  const approve = () => {
    if (!selectedVideoId) {
      toast.error('Select a YouTube video first');
      return;
    }
    onApprove(current, {
      title: current.trackData.title,
      artist: current.trackData.artist,
      animeName: current.trackData.animeName,
      type: current.trackData.type,
      youtubeId: selectedVideoId,
      customImageUrl: current.trackData.customImageUrl,
    });
    setCurrentIndex(prev => Math.min(prev + 1, proposals.length - 1));
    setYoutubeSearchResults([]);
    setSelectedVideoId(null);
    toast.success('Proposal approved!');
  };

  const reject = () => {
    onReject(current);
    setCurrentIndex(prev => Math.min(prev + 1, proposals.length - 1));
    setYoutubeSearchResults([]);
    setSelectedVideoId(null);
    toast.success('Proposal rejected');
  };

  const td = current.trackData;

  return (
    <div className="space-y-4">
      {/* Progress indicator */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-zinc-500 uppercase tracking-wider">
          Reviewing {currentIndex + 1} of {proposals.length}
        </span>
        <div className="flex gap-1">
          <button
            onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))}
            disabled={currentIndex === 0}
            className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setCurrentIndex(prev => Math.min(proposals.length - 1, prev + 1))}
            disabled={currentIndex === proposals.length - 1}
            className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Proposal Card */}
      <div className="bg-zinc-950 border border-zinc-900 rounded-xl overflow-hidden">
        <div className="grid md:grid-cols-2 gap-4 p-4">
          {/* Left: Track Info */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className={`px-2 py-1 rounded text-[10px] font-black uppercase ${
                td.type === 'OP' ? 'bg-indigo-ink/20 text-gold-bright' :
                td.type === 'ED' ? 'bg-vermillion/20 text-vermillion' :
                'bg-gold/20 text-gold-bright'
              }`}>
                {td.type}
              </span>
              <span className="text-[10px] font-mono text-zinc-500 uppercase">
                {current.type === 'add_track' ? 'New Track' : current.type === 'fix_link' ? 'Fix Link' : 'Report'}
              </span>
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">{td.title}</h3>
              <p className="text-sm text-zinc-400">{td.artist}</p>
              <p className="text-xs text-zinc-500 mt-1 flex items-center gap-1">
                <Tv className="w-3 h-3" /> {td.animeName}
              </p>
            </div>
            {current.notes && (
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
                <p className="text-[10px] font-mono text-zinc-500 uppercase mb-1">Submitter Notes</p>
                <p className="text-xs text-zinc-300">{current.notes}</p>
              </div>
            )}
            <div className="text-[10px] font-mono text-zinc-600">
              Submitted by {current.submittedBy} on {new Date(current.submittedAt).toLocaleDateString()}
            </div>
          </div>

          {/* Right: YouTube Search + Preview */}
          <div className="space-y-3">
            <button
              onClick={searchYoutube}
              disabled={searching}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-brand-primary/10 border border-brand-primary/30 text-brand-primary text-xs font-mono font-black uppercase tracking-wider hover:bg-brand-primary/20 transition-all"
            >
              {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              <span>{searching ? 'Searching...' : 'Search YouTube'}</span>
            </button>

            {/* Selected video preview */}
            {selectedVideoId && (
              <div className="aspect-video rounded-lg overflow-hidden bg-black border border-zinc-800">
                <iframe
                  src={`https://www.youtube.com/embed/${selectedVideoId}`}
                  className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            )}

            {/* Search results */}
            {youtubeSearchResults.length > 0 && (
              <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                {youtubeSearchResults.slice(0, 8).map((video: any) => (
                  <button
                    key={video.videoId}
                    onClick={() => setSelectedVideoId(video.videoId)}
                    className={`w-full flex items-center gap-2 p-2 rounded-lg border transition-all text-left ${
                      selectedVideoId === video.videoId
                        ? 'bg-brand-primary/10 border-brand-primary/50'
                        : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    <img
                      src={`https://img.youtube.com/vi/${video.videoId}/default.jpg`}
                      className="w-16 h-10 object-cover rounded shrink-0"
                      loading="lazy"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-white truncate">{video.title}</p>
                      <p className="text-[10px] text-zinc-500 truncate">{video.author} · {video.duration}</p>
                    </div>
                    {selectedVideoId === video.videoId && (
                      <Check className="w-4 h-4 text-brand-primary shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 p-4 border-t border-zinc-900 bg-zinc-950">
          <button
            onClick={approve}
            disabled={!selectedVideoId}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg bg-moss text-zinc-950 font-black text-xs uppercase tracking-wider hover:bg-brand-secondary-hover disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <CheckCircle className="w-4 h-4" />
            <span>Approve & Add</span>
          </button>
          <button
            onClick={reject}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg bg-vermillion/10 border border-vermillion/30 text-vermillion font-black text-xs uppercase tracking-wider hover:bg-vermillion/20 transition-all"
          >
            <XCircle className="w-4 h-4" />
            <span>Reject</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// 2. LINK COMPARE — side-by-side YouTube video comparison for a track
// ===========================================================================

function LinkCompareTool({
  tracks,
  onUpdateTrack,
}: {
  tracks: AnimeTrack[];
  onUpdateTrack: (trackId: string, updates: Partial<AnimeTrack>) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTrack, setSelectedTrack] = useState<AnimeTrack | null>(null);
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  const filteredTracks = searchQuery
    ? tracks.filter(t =>
        t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.animeName.toLowerCase().includes(searchQuery.toLowerCase())
      ).slice(0, 10)
    : [];

  const searchYoutube = async (track: AnimeTrack) => {
    setSelectedTrack(track);
    setSearching(true);
    setResults([]);
    try {
      const query = `${track.animeName} ${track.type} ${track.title} ${track.artist}`;
      const res = await apiFetch(`/api/youtube-search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setResults(data.videos || []);
    } catch (err: any) {
      toast.error('Search failed: ' + err.message);
    } finally {
      setSearching(false);
    }
  };

  const selectVideo = (videoId: string) => {
    if (!selectedTrack) return;
    onUpdateTrack(selectedTrack.id, { youtubeId: videoId });
    toast.success('YouTube link updated!');
  };

  return (
    <div className="space-y-4">
      {/* Track Search */}
      <div className="relative">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search tracks to compare links..."
          className="w-full px-4 py-3 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:border-brand-primary focus:outline-none"
        />
        {filteredTracks.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden z-20 max-h-60 overflow-y-auto">
            {filteredTracks.map(track => (
              <button
                key={track.id}
                onClick={() => {
                  setSelectedTrack(track);
                  setSearchQuery('');
                  searchYoutube(track);
                }}
                className="w-full flex items-center gap-3 p-3 hover:bg-zinc-900 text-left border-b border-zinc-900 last:border-0"
              >
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${
                  track.type === 'OP' ? 'bg-indigo-ink/20 text-gold-bright' :
                  track.type === 'ED' ? 'bg-vermillion/20 text-vermillion' :
                  'bg-gold/20 text-gold-bright'
                }`}>{track.type}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white truncate">{track.title}</p>
                  <p className="text-xs text-zinc-500 truncate">{track.animeName} · {track.artist}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Current + Search Results */}
      {selectedTrack && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-white">{selectedTrack.title}</p>
              <p className="text-xs text-zinc-500">{selectedTrack.animeName} · {selectedTrack.artist}</p>
            </div>
            <button
              onClick={() => searchYoutube(selectedTrack)}
              className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {/* Current video */}
          {selectedTrack.youtubeId && (
            <div>
              <p className="text-[10px] font-mono text-zinc-500 uppercase mb-1.5">Current Link</p>
              <div className="aspect-video rounded-lg overflow-hidden bg-black border border-zinc-800">
                <iframe
                  src={`https://www.youtube.com/embed/${selectedTrack.youtubeId}`}
                  className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            </div>
          )}

          {/* Search results grid */}
          {searching ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-brand-primary" />
            </div>
          ) : results.length > 0 ? (
            <div>
              <p className="text-[10px] font-mono text-zinc-500 uppercase mb-2">Click a video to set as the new link</p>
              <div className="grid sm:grid-cols-2 gap-2">
                {results.slice(0, 6).map((video: any) => (
                  <button
                    key={video.videoId}
                    onClick={() => selectVideo(video.videoId)}
                    className={`group flex flex-col rounded-lg overflow-hidden border transition-all text-left ${
                      selectedTrack.youtubeId === video.videoId
                        ? 'border-moss bg-moss/5'
                        : 'border-zinc-800 hover:border-zinc-700 bg-zinc-950'
                    }`}
                  >
                    <div className="relative aspect-video bg-black">
                      <img
                        src={`https://img.youtube.com/vi/${video.videoId}/mqdefault.jpg`}
                        className="w-full h-full object-cover group-hover:opacity-80 transition-opacity"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <Play className="w-8 h-8 text-white fill-white" />
                      </div>
                      {selectedTrack.youtubeId === video.videoId && (
                        <div className="absolute top-2 right-2 bg-moss rounded-full p-1">
                          <Check className="w-3 h-3 text-white" />
                        </div>
                      )}
                    </div>
                    <div className="p-2">
                      <p className="text-xs text-white line-clamp-2">{video.title}</p>
                      <p className="text-[10px] text-zinc-500 mt-1">{video.author} · {video.duration}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {!selectedTrack && !searchQuery && (
        <div className="bg-zinc-950 border border-zinc-900 rounded-xl p-8 text-center">
          <Link2 className="w-12 h-12 text-zinc-700 mx-auto mb-3" />
          <p className="text-zinc-400 text-sm">Search for a track above to compare YouTube links side-by-side.</p>
          <p className="text-zinc-600 text-xs mt-1">Visual grid of video thumbnails — click to set the best link.</p>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// 3. COVER ART PICKER — visual grid of cover art from iTunes/MusicBrainz
// ===========================================================================

function CoverArtPicker({
  tracks,
  onUpdateTrack,
}: {
  tracks: AnimeTrack[];
  onUpdateTrack: (trackId: string, updates: Partial<AnimeTrack>) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTrack, setSelectedTrack] = useState<AnimeTrack | null>(null);
  const [coverOptions, setCoverOptions] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);

  const filteredTracks = searchQuery
    ? tracks.filter(t =>
        t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.animeName.toLowerCase().includes(searchQuery.toLowerCase())
      ).slice(0, 10)
    : [];

  const searchCovers = async (track: AnimeTrack) => {
    setSelectedTrack(track);
    setSearching(true);
    setCoverOptions([]);
    try {
      // Fetch cover art ONLY from iTunes (high quality, official album art)
      const itunesRes = await apiFetch(`/api/itunes-albums?animeName=${encodeURIComponent(track.animeName)}`);
      const itunesData = await itunesRes.json();
      const covers: string[] = [];

      if (itunesData.albums) {
        itunesData.albums.forEach((album: any) => {
          if (album.artworkUrl) {
            // Upgrade to highest resolution (600x600)
            const hiRes = album.artworkUrl.replace('100x100bb', '600x600bb');
            covers.push(hiRes);
          }
        });
      }

      setCoverOptions([...new Set(covers)]);
    } catch (err: any) {
      toast.error('Cover search failed: ' + err.message);
    } finally {
      setSearching(false);
    }
  };

  const selectCover = (url: string) => {
    if (!selectedTrack) return;
    onUpdateTrack(selectedTrack.id, { customImageUrl: url });
    toast.success('Cover art updated!');
  };

  return (
    <div className="space-y-4">
      <div className="relative">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search tracks to pick cover art..."
          className="w-full px-4 py-3 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:border-brand-primary focus:outline-none"
        />
        {filteredTracks.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden z-20 max-h-60 overflow-y-auto">
            {filteredTracks.map(track => (
              <button
                key={track.id}
                onClick={() => {
                  setSelectedTrack(track);
                  setSearchQuery('');
                  searchCovers(track);
                }}
                className="w-full flex items-center gap-3 p-3 hover:bg-zinc-900 text-left border-b border-zinc-900 last:border-0"
              >
                <img
                  src={track.customImageUrl || `https://via.placeholder.com/40x40/0a0c10/333333?text=?`}
                  className="w-10 h-10 object-cover rounded shrink-0 bg-zinc-900"
                  loading="lazy"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white truncate">{track.title}</p>
                  <p className="text-xs text-zinc-500 truncate">{track.animeName}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedTrack && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-white">{selectedTrack.title}</p>
              <p className="text-xs text-zinc-500">{selectedTrack.animeName}</p>
            </div>
            <button
              onClick={() => searchCovers(selectedTrack)}
              className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {searching ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-brand-primary" />
            </div>
          ) : coverOptions.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {coverOptions.map((url, i) => (
                <button
                  key={i}
                  onClick={() => selectCover(url)}
                  className={`group relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                    selectedTrack.customImageUrl === url
                      ? 'border-moss'
                      : 'border-transparent hover:border-zinc-600'
                  }`}
                >
                  <img
                    src={url}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.opacity = '0.3';
                    }}
                  />
                  {selectedTrack.customImageUrl === url && (
                    <div className="absolute inset-0 bg-moss/20 flex items-center justify-center">
                      <Check className="w-6 h-6 text-white" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-zinc-500 text-sm text-center py-8">No cover art found. Try another track.</p>
          )}
        </div>
      )}

      {!selectedTrack && !searchQuery && (
        <div className="bg-zinc-950 border border-zinc-900 rounded-xl p-8 text-center">
          <ImageIcon className="w-12 h-12 text-zinc-700 mx-auto mb-3" />
          <p className="text-zinc-400 text-sm">Search for a track to pick cover art.</p>
          <p className="text-zinc-600 text-xs mt-1">Visual grid from iTunes + YouTube thumbnails — click to set.</p>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// 4. BULK TAG EDITOR — apply tags to multiple tracks at once
// ===========================================================================

function BulkTagEditor({
  tracks,
  onUpdateTrack,
}: {
  tracks: AnimeTrack[];
  onUpdateTrack: (trackId: string, updates: Partial<AnimeTrack>) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTrack, setSelectedTrack] = useState<AnimeTrack | null>(null);
  const [currentTags, setCurrentTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [autoTagging, setAutoTagging] = useState(false);

  const filteredTracks = searchQuery
    ? tracks.filter(t =>
        t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.animeName.toLowerCase().includes(searchQuery.toLowerCase())
      ).slice(0, 10)
    : [];

  const selectTrack = (track: AnimeTrack) => {
    setSelectedTrack(track);
    setCurrentTags(track.tags || []);
    setSearchQuery('');
    setTagInput('');
  };

  const addTag = () => {
    const tag = tagInput.trim();
    if (!tag || currentTags.includes(tag)) return;
    setCurrentTags([...currentTags, tag]);
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    setCurrentTags(currentTags.filter(t => t !== tag));
  };

  const saveTags = () => {
    if (!selectedTrack) return;
    onUpdateTrack(selectedTrack.id, { tags: currentTags });
    toast.success('Tags saved!');
  };

  const autoTag = async () => {
    if (!selectedTrack) return;
    setAutoTagging(true);
    try {
      const res = await apiFetch('/api/auto-tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: selectedTrack.title,
          artist: selectedTrack.artist,
          animeName: selectedTrack.animeName,
          type: selectedTrack.type,
        }),
      });
      const data = await res.json();
      if (data.tags) {
        setCurrentTags(data.tags);
        toast.success(`Auto-tagged: ${data.tags.join(', ')}`);
      }
    } catch (err: any) {
      toast.error('Auto-tag failed: ' + err.message);
    } finally {
      setAutoTagging(false);
    }
  };

  const commonTags = [
    // Song-oriented tags only — NO OP/ED/OST (those are track types, not tags)
    'Rock', 'Pop', 'Electronic', 'Orchestral', 'Acoustic', 'Metal', 'Jazz', 'Hip-Hop',
    'J-Rock', 'J-Pop', 'Anisong', 'Synth', 'Dance',
    'Hype', 'Epic', 'Emotional', 'Chill', 'Nostalgic', 'Intense', 'Sad',
    'Romantic', 'Dark', 'Uplifting', 'Energetic', 'Aggressive', 'Dreamy',
    'Fast', 'Slow', 'Ballad', 'Upbeat',
    'Male Vocal', 'Female Vocal', 'Group Vocal', 'Instrumental',
  ];

  return (
    <div className="space-y-4">
      <div className="relative">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search tracks to edit tags..."
          className="w-full px-4 py-3 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:border-brand-primary focus:outline-none"
        />
        {filteredTracks.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden z-20 max-h-60 overflow-y-auto">
            {filteredTracks.map(track => (
              <button
                key={track.id}
                onClick={() => selectTrack(track)}
                className="w-full flex items-center gap-3 p-3 hover:bg-zinc-900 text-left border-b border-zinc-900 last:border-0"
              >
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${
                  track.type === 'OP' ? 'bg-indigo-ink/20 text-gold-bright' :
                  track.type === 'ED' ? 'bg-vermillion/20 text-vermillion' :
                  'bg-gold/20 text-gold-bright'
                }`}>{track.type}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white truncate">{track.title}</p>
                  <p className="text-xs text-zinc-500 truncate">{track.animeName}</p>
                </div>
                <div className="flex gap-1 flex-wrap justify-end max-w-[40%]">
                  {(track.tags || []).slice(0, 3).map(tag => (
                    <span key={tag} className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[9px]">{tag}</span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedTrack && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-white">{selectedTrack.title}</p>
              <p className="text-xs text-zinc-500">{selectedTrack.animeName} · {selectedTrack.artist}</p>
            </div>
            <button
              onClick={autoTag}
              disabled={autoTagging}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-vermillion/10 border border-vermillion/30 text-vermillion text-xs font-mono font-black uppercase hover:bg-vermillion/20 transition-all"
            >
              {autoTagging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              <span>Auto-Tag</span>
            </button>
          </div>

          {/* Current tags */}
          <div className="flex flex-wrap gap-1.5 min-h-[40px] p-3 bg-zinc-950 border border-zinc-800 rounded-lg">
            {currentTags.length === 0 ? (
              <span className="text-xs text-zinc-600">No tags yet. Add some below or use Auto-Tag.</span>
            ) : (
              currentTags.map(tag => (
                <span
                  key={tag}
                  className="flex items-center gap-1 px-2 py-1 rounded-md bg-brand-primary/10 border border-brand-primary/30 text-brand-primary text-xs font-mono"
                >
                  {tag}
                  <button onClick={() => removeTag(tag)} className="hover:text-vermillion">
                    <XCircle className="w-3 h-3" />
                  </button>
                </span>
              ))
            )}
          </div>

          {/* Add tag input */}
          <div className="flex gap-2">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTag()}
              placeholder="Add a tag..."
              className="flex-1 px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-white placeholder-zinc-600 focus:border-brand-primary focus:outline-none"
            />
            <button
              onClick={addTag}
              className="px-4 py-2 rounded-lg bg-zinc-800 text-white text-sm font-bold hover:bg-zinc-700"
            >
              Add
            </button>
          </div>

          {/* Quick-add common tags */}
          <div>
            <p className="text-[10px] font-mono text-zinc-500 uppercase mb-1.5">Quick Add</p>
            <div className="flex flex-wrap gap-1">
              {commonTags.map(tag => (
                <button
                  key={tag}
                  onClick={() => !currentTags.includes(tag) && setCurrentTags([...currentTags, tag])}
                  disabled={currentTags.includes(tag)}
                  className="px-2 py-1 rounded text-[10px] font-mono font-bold uppercase bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  + {tag}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={saveTags}
            className="w-full py-3 rounded-lg bg-moss text-zinc-950 font-black text-xs uppercase tracking-wider hover:bg-brand-secondary-hover"
          >
            Save Tags
          </button>
        </div>
      )}

      {!selectedTrack && !searchQuery && (
        <div className="bg-zinc-950 border border-zinc-900 rounded-xl p-8 text-center">
          <Tag className="w-12 h-12 text-zinc-700 mx-auto mb-3" />
          <p className="text-zinc-400 text-sm">Search for a track to edit its tags.</p>
          <p className="text-zinc-600 text-xs mt-1">Use Auto-Tag for AI-powered suggestions or add manually.</p>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// 0. SMART IMPORT — selective anime + track import with visual previews
// ===========================================================================

function SmartImportTool({
  onBulkAddTracks,
}: {
  onBulkAddTracks?: (tracks: AnimeTrack[]) => Promise<number>;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedAnime, setSelectedAnime] = useState<any | null>(null);
  const [themes, setThemes] = useState<any[]>([]);
  const [loadingThemes, setLoadingThemes] = useState(false);
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'OP' | 'ED' | 'OST'>('ALL');

  // Search for anime via Jikan
  const searchAnime = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchResults([]);
    try {
      const res = await apiFetch(`/api/anime-search?q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      setSearchResults(data.data || []);
    } catch (err: any) {
      toast.error('Search failed: ' + err.message);
    } finally {
      setSearching(false);
    }
  };

  // Fetch themes for a selected anime via AnimeThemes
  const fetchThemes = async (anime: any) => {
    setSelectedAnime(anime);
    setLoadingThemes(true);
    setThemes([]);
    setSelectedTrackIds(new Set());
    try {
      const res = await apiFetch(`/api/animethemes-search?animeName=${encodeURIComponent(anime.title)}`);
      const data = await res.json();
      if (data.tracks && data.tracks.length > 0) {
        setThemes(data.tracks);
        // Auto-select all by default
        setSelectedTrackIds(new Set(data.tracks.map((t: any) => t.title + t.type)));
      } else {
        toast.info('No themes found for this anime. Try another search.');
      }
    } catch (err: any) {
      toast.error('Theme fetch failed: ' + err.message);
    } finally {
      setLoadingThemes(false);
    }
  };

  const toggleTrack = (track: any) => {
    const id = track.title + track.type;
    setSelectedTrackIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredThemes = themes.filter(t => typeFilter === 'ALL' || t.type === typeFilter);

  const importSelected = async () => {
    if (!onBulkAddTracks || selectedTrackIds.size === 0) return;
    setImporting(true);
    try {
      const tracksToImport = themes
        .filter(t => selectedTrackIds.has(t.title + t.type))
        .map(t => ({
          id: `import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          title: t.title,
          artist: t.artist,
          animeName: t.animeName,
          type: t.type,
          youtubeId: '',
          elo: 1200,
          matchesPlayed: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          addedByUser: false,
          tags: ['Hype'],
        } as AnimeTrack));
      
      const count = await onBulkAddTracks(tracksToImport);
      toast.success(`Imported ${count} track(s)!`);
      setSelectedTrackIds(new Set());
      setThemes([]);
      setSelectedAnime(null);
    } catch (err: any) {
      toast.error('Import failed: ' + err.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <div className="flex gap-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && searchAnime()}
          placeholder="Search for an anime to import themes from..."
          className="flex-1 px-4 py-3 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:border-brand-primary focus:outline-none"
        />
        <button
          onClick={searchAnime}
          disabled={searching || !searchQuery.trim()}
          className="flex items-center gap-2 px-5 py-3 rounded-xl bg-brand-primary text-zinc-950 font-black text-xs uppercase tracking-wider hover:bg-brand-primary-hover disabled:opacity-30 transition-all"
        >
          {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          <span>Search</span>
        </button>
      </div>

      {/* Search Results (anime list) */}
      {searchResults.length > 0 && !selectedAnime && (
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
          {searchResults.map((anime: any) => (
            <button
              key={anime.mal_id}
              onClick={() => fetchThemes(anime)}
              className="group flex items-center gap-3 p-3 bg-zinc-950 border border-zinc-800 hover:border-brand-primary/50 rounded-xl transition-all text-left"
            >
              {anime.images?.jpg?.image_url && (
                <img
                  src={anime.images.jpg.image_url}
                  className="w-12 h-16 object-cover rounded shrink-0"
                  loading="lazy"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white font-bold line-clamp-2">{anime.title}</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">
                  {anime.year || 'Unknown year'} · {anime.type || 'TV'}
                </p>
                {anime.score && (
                  <p className="text-[10px] text-gold-bright mt-0.5">★ {anime.score}</p>
                )}
              </div>
              <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-brand-primary shrink-0" />
            </button>
          ))}
        </div>
      )}

      {/* Selected Anime — Theme Selection */}
      {selectedAnime && (
        <div className="space-y-3">
          {/* Back button + anime info */}
          <div className="flex items-center gap-3 p-3 bg-zinc-950 border border-zinc-800 rounded-xl">
            <button
              onClick={() => { setSelectedAnime(null); setThemes([]); setSelectedTrackIds(new Set()); }}
              className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white shrink-0"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            {selectedAnime.images?.jpg?.image_url && (
              <img src={selectedAnime.images.jpg.image_url} className="w-10 h-14 object-cover rounded shrink-0" loading="lazy" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white truncate">{selectedAnime.title}</p>
              <p className="text-[10px] text-zinc-500">{selectedAnime.year} · {selectedAnime.type}</p>
            </div>
            {/* Type filter */}
            <div className="flex items-center gap-1 shrink-0">
              {(['ALL', 'OP', 'ED', 'OST'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={`px-2 py-1 rounded text-[10px] font-mono font-black uppercase ${
                    typeFilter === t ? 'bg-zinc-700 text-white' : 'bg-zinc-900 text-zinc-500'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Loading */}
          {loadingThemes && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-brand-primary" />
              <span className="ml-2 text-sm text-zinc-400">Fetching themes...</span>
            </div>
          )}

          {/* Theme list — selectable */}
          {!loadingThemes && filteredThemes.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs font-mono text-zinc-500 uppercase">
                  {selectedTrackIds.size} of {filteredThemes.length} selected
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSelectedTrackIds(new Set(filteredThemes.map(t => t.title + t.type)))}
                    className="text-[10px] font-mono text-zinc-400 hover:text-white uppercase"
                  >
                    Select All
                  </button>
                  <button
                    onClick={() => setSelectedTrackIds(new Set())}
                    className="text-[10px] font-mono text-zinc-400 hover:text-white uppercase"
                  >
                    Deselect All
                  </button>
                </div>
              </div>

              <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
                {filteredThemes.map((track: any, i: number) => {
                  const id = track.title + track.type;
                  const isSelected = selectedTrackIds.has(id);
                  return (
                    <button
                      key={i}
                      onClick={() => toggleTrack(track)}
                      className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${
                        isSelected
                          ? 'bg-brand-primary/10 border-brand-primary/40'
                          : 'bg-zinc-950 border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      {/* Checkbox */}
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${
                        isSelected ? 'bg-brand-primary border-brand-primary' : 'border-zinc-700'
                      }`}>
                        {isSelected && <Check className="w-3 h-3 text-zinc-950" />}
                      </div>
                      {/* Type badge */}
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase shrink-0 ${
                        track.type === 'OP' ? 'bg-indigo-ink/20 text-gold-bright' :
                        track.type === 'ED' ? 'bg-vermillion/20 text-vermillion' :
                        'bg-gold/20 text-gold-bright'
                      }`}>{track.type}</span>
                      {/* Track info */}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-white truncate">{track.title}</p>
                        <p className="text-[10px] text-zinc-500 truncate">{track.artist}</p>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Import button */}
              <button
                onClick={importSelected}
                disabled={importing || selectedTrackIds.size === 0}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-moss text-zinc-950 font-black text-xs uppercase tracking-wider hover:bg-brand-secondary-hover disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                <span>{importing ? 'Importing...' : `Import ${selectedTrackIds.size} Track(s)`}</span>
              </button>
            </>
          )}

          {!loadingThemes && filteredThemes.length === 0 && themes.length === 0 && (
            <div className="bg-zinc-950 border border-zinc-900 rounded-xl p-8 text-center">
              <Music className="w-12 h-12 text-zinc-700 mx-auto mb-3" />
              <p className="text-zinc-400 text-sm">No themes found for this anime.</p>
              <p className="text-zinc-600 text-xs mt-1">Try searching for a different title or use the bulk import instead.</p>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!searchResults.length && !selectedAnime && !searching && (
        <div className="bg-zinc-950 border border-zinc-900 rounded-xl p-8 text-center">
          <Download className="w-12 h-12 text-zinc-700 mx-auto mb-3" />
          <p className="text-zinc-400 text-sm">Search for an anime to selectively import its themes.</p>
          <p className="text-zinc-600 text-xs mt-1">You pick which anime and which tracks to add — full control.</p>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// 5. ARTIST LOOKUP — auto-find artists for tracks with "Unknown Artist"
//
// Cascades through AnimeThemes → iTunes → MusicBrainz on the server (see
// /api/lookup-artist) and surfaces the result with a confidence indicator.
// Supports both per-track lookup and a bulk "Lookup All" run that processes
// every Unknown Artist track in the catalog in one shot.
// ===========================================================================

interface LookupResult {
  artist: string | null;
  source: string; // 'animethemes' | 'itunes' | 'musicbrainz' | 'none'
  candidates?: Array<{ artist: string; source: string; confidence: number }>;
  cached?: boolean;
}

function sourceColor(source: string): string {
  switch (source) {
    case 'animethemes':  return 'text-vermillion-tint bg-indigo-ink/10 border-indigo-ink/30';
    case 'itunes':       return 'text-vermillion bg-vermillion/10 border-vermillion/30';
    case 'musicbrainz':  return 'text-gold-bright bg-gold/10 border-gold/30';
    default:             return 'text-zinc-500 bg-zinc-700/10 border-zinc-700/30';
  }
}

function sourceLabel(source: string): string {
  switch (source) {
    case 'animethemes':  return 'AnimeThemes';
    case 'itunes':       return 'iTunes';
    case 'musicbrainz':  return 'MusicBrainz';
    case 'none':         return 'No match';
    default:             return source;
  }
}

function ArtistLookupTool({
  tracks,
  onUpdateTrack,
}: {
  tracks: AnimeTrack[];
  onUpdateTrack: (trackId: string, updates: Partial<AnimeTrack>) => void;
}) {
  // Pre-filtered queue: only tracks with missing/Unknown artists.
  const unknownTracks = useMemo(
    () => tracks.filter(t => isUnknownArtist(t.artist)),
    [tracks],
  );

  // Lookup results keyed by track ID.
  const [results, setResults] = useState<Record<string, LookupResult>>({});
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [searchQuery, setSearchQuery] = useState('');
  // Tracks the user has "applied" (saved to Firestore) — hidden from the list.
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());

  const filteredUnknownTracks = useMemo(() => {
    if (!searchQuery.trim()) return unknownTracks;
    const q = searchQuery.toLowerCase();
    return unknownTracks.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.animeName.toLowerCase().includes(q),
    );
  }, [unknownTracks, searchQuery]);

  // Lookup a single track.
  const lookupOne = async (track: AnimeTrack) => {
    setLoadingIds(prev => new Set(prev).add(track.id));
    try {
      const res = await apiFetch('/api/lookup-artist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          animeName: track.animeName,
          title: track.title,
          type: track.type,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data: LookupResult = await res.json();
      setResults(prev => ({ ...prev, [track.id]: data }));
    } catch (err: any) {
      toast.error(`Lookup failed for "${track.title}": ${err.message}`);
      setResults(prev => ({
        ...prev,
        [track.id]: { artist: null, source: 'none' },
      }));
    } finally {
      setLoadingIds(prev => {
        const next = new Set(prev);
        next.delete(track.id);
        return next;
      });
    }
  };

  // Apply a single track's looked-up artist to Firestore.
  const applyOne = (track: AnimeTrack, artist: string) => {
    onUpdateTrack(track.id, { artist });
    setAppliedIds(prev => new Set(prev).add(track.id));
    toast.success(`Artist set to "${artist}" for "${track.title}"`);
  };

  // Apply ALL successfully-looked-up tracks at once.
  const applyAll = () => {
    let count = 0;
    for (const track of unknownTracks) {
      const r = results[track.id];
      if (r?.artist && !appliedIds.has(track.id)) {
        onUpdateTrack(track.id, { artist: r.artist });
        count++;
      }
    }
    if (count > 0) {
      setAppliedIds(prev => {
        const next = new Set(prev);
        for (const track of unknownTracks) {
          const r = results[track.id];
          if (r?.artist) next.add(track.id);
        }
        return next;
      });
      toast.success(`Applied artist updates to ${count} track(s)!`);
    } else {
      toast.info('No new artist results to apply. Run "Lookup All" first.');
    }
  };

  // Bulk lookup — chunks the queue into 8-track batches (was 50; the
  // larger batches blew the hosting platform's request timeout even
  // though the per-source rate limiting was OK). The server now runs
  // the 3 upstream sources (AnimeThemes, iTunes, MusicBrainz) in
  // PARALLEL per track with a 12s per-source timeout + a 25s overall
  // hard timeout that returns partial results, so an 8-track batch
  // finishes in ~3-15s typical / ~25s worst case.
  //
  // Each batch request is wrapped in a client-side AbortController with
  // a 28s timeout (3s headroom over the server's 25s hard limit) so the
  // client never hangs waiting on a wedged connection. On timeout, the
  // batch is retried ONCE with the size halved (4 → split into 2 halves
  // of 2 each); if the retry also fails, the run aborts with a clear
  // message but already-processed batches are kept.
  //
  // On HTTP 429 we back off 5s and retry that batch once.
  //
  // Per-batch progress is streamed into `bulkProgress` so the UI's
  // progress bar reflects real-time work, not just "started / done".
  const lookupAll = async () => {
    if (unknownTracks.length === 0) return;
    setBulkRunning(true);
    setBulkProgress({ done: 0, total: unknownTracks.length });

    const BATCH_SIZE = 8;
    const INTER_BATCH_PAUSE_MS = 1500;
    const RATE_LIMIT_BACKOFF_MS = 5000;
    const CLIENT_TIMEOUT_MS = 28_000; // 3s headroom over server's 25s hard cap
    let processed = 0;
    let totalFound = 0;

    // Recursive sub-batch splitter — when a full batch times out, halve
    // it and try each half separately. Bottoms out at single-track calls
    // (which can still time out, but at least the OTHER half succeeds).
    const sendBatch = async (
      batchTracks: typeof unknownTracks,
      batchIndex: number,
    ): Promise<Record<string, LookupResult>> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
      try {
        const res = await apiFetch('/api/lookup-artists-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tracks: batchTracks.map(t => ({
              id: t.id,
              animeName: t.animeName,
              title: t.title,
              type: t.type,
            })),
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (res.status === 429) {
          toast.info(`Rate-limited by upstream — backing off ${RATE_LIMIT_BACKOFF_MS / 1000}s before retry (batch ${batchIndex + 1})...`);
          await new Promise(r => setTimeout(r, RATE_LIMIT_BACKOFF_MS));
          return sendBatch(batchTracks, batchIndex);
        }
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        const batchResults: Record<string, LookupResult> = {};
        for (const [id, entry] of Object.entries(data.results || {})) {
          batchResults[id] = entry as LookupResult;
        }
        // Surface the partial-results flag from the server (set when the
        // server's 25s hard timeout fires) so the user knows the run
        // didn't fully finish this batch.
        if (data.partial) {
          toast.info(`Batch ${batchIndex + 1}: server timed out — resolved ${data.resolved_count}/${data.total_count} tracks. Retrying the missing ones...`);
          const missing = batchTracks.filter(t => !batchResults[t.id]);
          if (missing.length > 0) {
            // Recursive retry on just the missing tracks — these are
            // the ones whose upstream calls hung. Single-track calls
            // almost always succeed because the server's parallel
            // sources + per-source timeout guarantee progress.
            for (const t of missing) {
              const retry = await sendBatch([t], batchIndex).catch(() => ({}));
              Object.assign(batchResults, retry);
            }
          }
        }
        return batchResults;
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          // Client timeout — try splitting the batch in half first.
          if (batchTracks.length > 1) {
            const mid = Math.floor(batchTracks.length / 2);
            const left = await sendBatch(batchTracks.slice(0, mid), batchIndex).catch(() => ({}));
            const right = await sendBatch(batchTracks.slice(mid), batchIndex).catch(() => ({}));
            return { ...left, ...right };
          }
          // Single track timed out — give up on this one and return what
          // we have. The run continues with the next batch.
          toast.error(`Track "${batchTracks[0]?.title || '?'}" timed out twice — skipping. (The server is overloaded; try again later.)`);
          return {};
        }
        throw err;
      }
    };

    try {
      for (let i = 0; i < unknownTracks.length; i += BATCH_SIZE) {
        const batch = unknownTracks.slice(i, i + BATCH_SIZE);
        const batchIndex = Math.floor(i / BATCH_SIZE);

        try {
          const batchResults = await sendBatch(batch, batchIndex);
          setResults(prev => ({ ...prev, ...batchResults }));
          const found = Object.values(batchResults).filter(r => r.artist).length;
          totalFound += found;
        } catch (err: any) {
          toast.error(`Bulk lookup aborted at batch ${batchIndex + 1}: ${err.message}`);
          break;
        }

        processed += batch.length;
        setBulkProgress({ done: processed, total: unknownTracks.length });

        if (i + BATCH_SIZE < unknownTracks.length) {
          await new Promise(r => setTimeout(r, INTER_BATCH_PAUSE_MS));
        }
      }

      toast.success(`Looked up ${processed} tracks — ${totalFound} had matches.`);
    } catch (err: any) {
      toast.error(`Bulk lookup failed: ${err.message}`);
    } finally {
      setBulkRunning(false);
    }
  };

  // Stats for the header summary.
  const foundCount = Object.values(results).filter(r => r?.artist).length;
  const appliedCount = appliedIds.size;

  return (
    <div className="space-y-4">
      {/* Header summary + bulk actions */}
      <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
              <UserSearch className="w-4 h-4 text-vermillion-tint" />
              Auto Artist Lookup
            </h3>
            <p className="text-xs text-zinc-500 mt-1">
              {unknownTracks.length} track{unknownTracks.length === 1 ? '' : 's'} with missing artist names.
              Smart cascade: <span className="text-vermillion-tint">AnimeThemes</span> → <span className="text-vermillion">iTunes</span> → <span className="text-gold-bright">MusicBrainz</span>.
              {foundCount > 0 && (
                <span className="ml-2 text-moss">· {foundCount} resolved</span>
              )}
              {appliedCount > 0 && (
                <span className="ml-2 text-moss">· {appliedCount} applied</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={lookupAll}
              disabled={bulkRunning || unknownTracks.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gold-bright text-zinc-950 text-xs font-black uppercase tracking-wider hover:bg-gold disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              title={`Chunks the queue into 8-track batches (was 50 — caused hosting-platform timeouts) with a 1.5s pause between each. The server runs the 3 upstream sources (AnimeThemes / iTunes / MusicBrainz) in PARALLEL per track with a 25s hard cap that returns partial results, so an 8-track batch finishes in 3-25s.`}
            >
              {bulkRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
              <span>{bulkRunning ? `Looking up ${bulkProgress.done}/${bulkProgress.total} (8/batch)...` : `Lookup All (${Math.ceil(unknownTracks.length / 8)} batches × 8)`}</span>
            </button>
            <button
              onClick={applyAll}
              disabled={foundCount === 0 || bulkRunning}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-moss text-zinc-950 text-xs font-black uppercase tracking-wider hover:bg-brand-secondary-hover disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Apply All ({foundCount})</span>
            </button>
          </div>
        </div>
        {/* Bulk progress bar */}
        {bulkRunning && (
          <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gold-bright transition-all duration-300"
              style={{ width: `${bulkProgress.total > 0 ? (bulkProgress.done / bulkProgress.total) * 100 : 0}%` }}
            />
          </div>
        )}
      </div>

      {/* Search filter */}
      {unknownTracks.length > 0 && (
        <div className="relative">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Filter ${unknownTracks.length} tracks by title or anime...`}
            className="w-full pl-10 pr-4 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:border-vermillion focus:outline-none"
          />
        </div>
      )}

      {/* Track list */}
      {filteredUnknownTracks.length > 0 ? (
        <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-1">
          {filteredUnknownTracks.slice(0, 100).map(track => {
            const result = results[track.id];
            const isLoading = loadingIds.has(track.id);
            const isApplied = appliedIds.has(track.id);

            return (
              <div
                key={track.id}
                className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                  isApplied
                    ? 'bg-moss/5 border-moss/30'
                    : 'bg-zinc-950 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                {/* Type badge */}
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase shrink-0 ${
                  track.type === 'OP' ? 'bg-indigo-ink/20 text-gold-bright' :
                  track.type === 'ED' ? 'bg-vermillion/20 text-vermillion' :
                  'bg-gold/20 text-gold-bright'
                }`}>{track.type}</span>

                {/* Track info */}
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white truncate">{track.title}</p>
                  <p className="text-[11px] text-zinc-500 truncate flex items-center gap-1.5">
                    <Tv className="w-3 h-3" />
                    {track.animeName}
                  </p>
                </div>

                {/* Lookup result */}
                <div className="flex items-center gap-2 shrink-0 max-w-[40%]">
                  {isLoading ? (
                    <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Looking up...
                    </span>
                  ) : result ? (
                    <div className="flex flex-col items-end gap-1">
                      <span className={`text-xs font-bold truncate max-w-[200px] ${
                        result.artist ? 'text-moss' : 'text-zinc-500'
                      }`}>
                        {result.artist || 'No match found'}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase border ${sourceColor(result.source)}`}>
                        {sourceLabel(result.source)}
                      </span>
                    </div>
                  ) : (
                    <span className="text-[11px] text-zinc-600 italic">Not looked up</span>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {!isApplied && (
                    <>
                      <button
                        onClick={() => lookupOne(track)}
                        disabled={isLoading || bulkRunning}
                        title="Lookup this track's artist"
                        className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-gold-bright hover:border-gold-bright/40 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                      >
                        <Search className="w-3.5 h-3.5" />
                      </button>
                      {result?.artist && (
                        <button
                          onClick={() => applyOne(track, result.artist!)}
                          title={`Apply "${result.artist}"`}
                          className="p-2 rounded-lg bg-moss/10 border border-moss/30 text-moss hover:bg-moss/20 transition-all"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </>
                  )}
                  {isApplied && (
                    <span className="px-2 py-1 rounded text-[10px] font-mono font-bold uppercase bg-moss/10 text-moss border border-moss/30 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" />
                      Applied
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {filteredUnknownTracks.length > 100 && (
            <p className="text-center text-xs text-zinc-600 py-2">
              Showing first 100 of {filteredUnknownTracks.length}. Use the filter above to narrow down.
            </p>
          )}
        </div>
      ) : (
        <div className="bg-zinc-950 border border-zinc-900 rounded-xl p-8 text-center">
          {unknownTracks.length === 0 ? (
            <>
              <CheckCircle className="w-12 h-12 text-moss mx-auto mb-3" />
              <p className="text-zinc-400 text-sm">All tracks have artist names!</p>
              <p className="text-zinc-600 text-xs mt-1">No lookups needed — your catalog is complete.</p>
            </>
          ) : (
            <>
              <Search className="w-12 h-12 text-zinc-700 mx-auto mb-3" />
              <p className="text-zinc-400 text-sm">No tracks match your filter.</p>
            </>
          )}
        </div>
      )}

      {/* Info banner explaining the cascade */}
      <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl">
        <div className="flex items-start gap-2">
          <Database className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
          <div className="text-[11px] text-zinc-500 space-y-1">
            <p>
              <span className="text-vermillion-tint font-bold">AnimeThemes</span> — canonical anime music DB. Best for OP/ED/OST; matches by anime + title + type.
            </p>
            <p>
              <span className="text-vermillion font-bold">iTunes</span> — official releases. Strong for tracks available as digital singles; falls back when AT has no entry.
            </p>
            <p>
              <span className="text-gold-bright font-bold">MusicBrainz</span> — open metadata. Catches OSTs and niche releases that aren't on iTunes.
            </p>
            <p className="text-zinc-600 mt-1.5">
              Results cached server-side for 24h. Bulk lookup runs at concurrency 3 to respect upstream rate limits.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SimilarityInvestigator — find duplicate/misspelled artists, tracks & anime
// in the DB via string similarity (Levenshtein + token-set), then merge them
// onto a canonical spelling in one click.
// ---------------------------------------------------------------------------

type SimilarityField = 'artist' | 'title' | 'animeName';

const SIMILARITY_FIELDS: { id: SimilarityField; label: string; hint: string }[] = [
  { id: 'artist', label: 'Artists', hint: 'misspelled artist names, order-swapped names, homoglyphs' },
  { id: 'animeName', label: 'Anime', hint: 'same series with different romanizations or seasons' },
  { id: 'title', label: 'Track Titles', hint: 'quotation/punctuation drift, feat-credit noise' },
];

function SimilarityInvestigator({
  tracks,
  onUpdateTrack,
}: {
  tracks: AnimeTrack[];
  onUpdateTrack: (trackId: string, updates: Partial<AnimeTrack>) => void;
}) {
  const [field, setField] = useState<SimilarityField>('artist');
  const [threshold, setThreshold] = useState(0.85);
  const [scanned, setScanned] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [groups, setGroups] = useState<SimilarityGroup<AnimeTrack>[]>([]);
  // Investigate mode: a specific name query
  const [probeQuery, setProbeQuery] = useState('');
  // Merge progress: track IDs already rewritten
  const [mergedIds, setMergedIds] = useState<Set<string>>(new Set());
  // Expanded group cards (by normalizedKey)
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const keyOf = (t: AnimeTrack): string | null | undefined => t[field];

  // ---- Cluster scan -------------------------------------------------------
  const runScan = () => {
    setScanning(true);
    // Defer so the spinner paints before the O(n²) pass blocks the thread.
    setTimeout(() => {
      const result = clusterSimilar(tracks, keyOf, threshold);
      setGroups(result);
      setScanned(true);
      setScanning(false);
      setExpanded(new Set(result.slice(0, 3).map(g => g.normalizedKey)));
      if (result.length === 0) {
        toast.success(`No similar ${SIMILARITY_FIELDS.find(f => f.id === field)!.label.toLowerCase()} clusters at ${Math.round(threshold * 100)}% threshold`);
      } else {
        toast.success(`Found ${result.length} cluster${result.length === 1 ? '' : 's'} across ${result.reduce((s, g) => s + g.members.length, 0)} name variants`);
      }
    }, 30);
  };

  // Re-run automatically when threshold/field changes AFTER first scan.
  const rerunOnParams = () => {
    if (!scanned) return;
    const result = clusterSimilar(tracks, keyOf, threshold);
    setGroups(result);
    setExpanded(new Set(result.slice(0, 3).map(g => g.normalizedKey)));
  };

  // ---- Probe (investigate one name) ---------------------------------------
  const probeResults = useMemo(() => {
    if (!probeQuery.trim() || probeQuery.trim().length < 2) return null;
    const matches = findSimilar(probeQuery, tracks, keyOf, 0.6);
    return matches.slice(0, 25);
  }, [probeQuery, tracks, field]);

  // Also show the exact-normalized twins of the probe (case/punct dupes).
  const probeExactTwins = useMemo(() => {
    if (!probeQuery.trim() || probeQuery.trim().length < 2) return [];
    const nq = normalizeName(probeQuery);
    if (!nq) return [];
    const seen = new Map<string, { name: string; count: number }>();
    for (const t of tracks) {
      const key = t[field];
      if (!key) continue;
      if (normalizeName(key) === nq) {
        const prev = seen.get(key) || { name: key, count: 0 };
        prev.count += 1;
        seen.set(key, prev);
      }
    }
    return [...seen.values()].sort((a, b) => b.count - a.count);
  }, [probeQuery, tracks, field]);

  // ---- Merge ---------------------------------------------------------------
  const mergeGroup = async (group: SimilarityGroup<AnimeTrack>, canonical: string) => {
    // All tracks whose current name differs from the canonical target.
    const targets = group.members
      .filter(m => m.name !== canonical)
      .flatMap(m => m.items)
      .filter(t => !mergedIds.has(t.id));
    if (targets.length === 0) {
      toast.info('Nothing to merge — already canonical.');
      return;
    }
    let ok = 0;
    for (const t of targets) {
      try {
        await onUpdateTrack(t.id, { [field]: canonical } as Partial<AnimeTrack>);
        ok += 1;
      } catch {
        // individual failure — keep going, report at end
      }
    }
    setMergedIds(prev => {
      const next = new Set(prev);
      targets.forEach(t => next.add(t.id));
      return next;
    });
    if (ok === targets.length) {
      toast.success(`Merged ${ok} track${ok === 1 ? '' : 's'} → "${canonical}"`);
    } else {
      toast.warning(`Merged ${ok}/${targets.length} — ${targets.length - ok} failed (check console)`);
    }
  };

  const mergedCount = mergedIds.size;

  return (
    <div className="space-y-4">
      {/* ---- Header ---- */}
      <div className="flex flex-col lg:flex-row gap-3 lg:items-end">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Fingerprint className="w-4 h-4 text-gold-bright" />
            <h4 className="font-display font-black text-lg text-white uppercase tracking-tight">
              Similarity Investigator
            </h4>
          </div>
          <p className="text-[11px] text-zinc-500 leading-relaxed">
            Finds names in the DB that are probably the same artist / anime / title — one-letter typos,
            swapped word order, homoglyphs (Cyrillic а), accent drift, punctuation noise. Pure string
            math (Levenshtein + token-set), no network calls. Merge rewrites the field on every affected
            track via the normal update path.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={runScan}
            disabled={scanning}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gold hover:bg-gold-bright text-zinc-950 text-[11px] font-mono font-black uppercase tracking-wider transition-all cursor-pointer disabled:opacity-40"
          >
            {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanEye className="w-3.5 h-3.5" />}
            {scanning ? 'Scanning…' : scanned ? 'Re-scan DB' : 'Scan DB'}
          </button>
        </div>
      </div>

      {/* ---- Controls ---- */}
      <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-3 items-center p-3 bg-zinc-950 border border-zinc-800 rounded-xl">
        {/* Field selector */}
        <div className="flex items-center gap-1.5">
          {SIMILARITY_FIELDS.map(f => (
            <button
              key={f.id}
              type="button"
              onClick={() => { setField(f.id); setScanned(false); setGroups([]); }}
              title={f.hint}
              className={`px-3 py-1.5 rounded-md text-[10px] font-mono font-black uppercase tracking-widest transition-all cursor-pointer border ${
                field === f.id
                  ? 'bg-indigo-ink/20 border-indigo-bright/40 text-gold-bright'
                  : 'bg-zinc-950 border-zinc-900 text-zinc-600 hover:text-zinc-400'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {/* Threshold slider */}
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono font-black uppercase tracking-widest text-zinc-600 shrink-0">
            Sensitivity
          </span>
          <input
            type="range"
            min={0.65}
            max={0.95}
            step={0.01}
            value={threshold}
            onChange={(e) => setThreshold(parseFloat(e.target.value))}
            onMouseUp={rerunOnParams}
            onTouchEnd={rerunOnParams}
            className="flex-1 accent-gold cursor-pointer"
          />
          <span className="font-mono text-[11px] font-black text-gold-bright tabular-nums w-9 text-right shrink-0">
            {Math.round(threshold * 100)}%
          </span>
          <span className="text-[9px] font-mono text-zinc-600 hidden sm:block shrink-0">
            {threshold >= 0.9 ? 'typos only' : threshold >= 0.8 ? 'balanced' : 'aggressive — may over-merge'}
          </span>
        </div>
      </div>

      {/* ---- Probe (investigate a single name) ---- */}
      <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl space-y-2">
        <div className="flex items-center gap-2">
          <UserSearch className="w-3.5 h-3.5 text-indigo-bright shrink-0" />
          <span className="text-[10px] font-mono font-black uppercase tracking-widest text-zinc-500">
            Investigate a specific name
          </span>
        </div>
        <input
          type="text"
          value={probeQuery}
          onChange={(e) => setProbeQuery(e.target.value)}
          placeholder={`Type an ${field === 'artist' ? 'artist' : field === 'animeName' ? 'anime' : 'track title'} name — e.g. "Hiroyuki Sawno"…`}
          className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:border-indigo-bright focus:outline-none"
        />
        {probeExactTwins.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[9px] font-mono uppercase tracking-widest text-moss shrink-0">exact twins (case/punct):</span>
            {probeExactTwins.map(t => (
              <span key={t.name} className="px-2 py-0.5 rounded bg-moss/10 border border-moss/30 text-moss text-[10px] font-mono font-bold">
                {t.name} ×{t.count}
              </span>
            ))}
          </div>
        )}
        {probeResults && probeResults.length === 0 && probeExactTwins.length <= 1 && (
          <p className="text-[11px] text-zinc-600 font-mono">No similar names found above 60% — this spelling looks unique.</p>
        )}
        {probeResults && probeResults.length > 0 && (
          <div className="space-y-1 max-h-52 overflow-y-auto pr-1">
            {probeResults.map((m, i) => (
              <div
                key={`${m.item.id}-${i}`}
                className="flex items-center justify-between gap-3 px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-mono font-bold text-zinc-200 truncate">{keyOf(m.item)}</span>
                  <span className="text-[9px] font-mono text-zinc-600 truncate hidden sm:inline">{m.item.animeName} · {m.item.type}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[9px] font-mono text-vermillion-tint">{m.reason}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-black tabular-nums ${
                    m.score >= 0.9 ? 'bg-vermillion/15 text-vermillion' : m.score >= 0.75 ? 'bg-gold/15 text-gold-bright' : 'bg-zinc-800 text-zinc-400'
                  }`}>
                    {Math.round(m.score * 100)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---- Cluster results ---- */}
      {scanning && (
        <div className="flex items-center justify-center gap-2 py-8 text-zinc-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-xs font-mono uppercase tracking-widest">Comparing every name pair…</span>
        </div>
      )}

      {!scanning && scanned && groups.length === 0 && (
        <div className="text-center py-8 bg-zinc-950 border border-zinc-800 rounded-xl">
          <CheckCircle className="w-8 h-8 text-moss mx-auto mb-2" />
          <p className="text-sm text-zinc-400 font-mono">No clusters at {Math.round(threshold * 100)}% — DB is clean at this sensitivity.</p>
          <p className="text-[10px] text-zinc-600 font-mono mt-1">Try lowering sensitivity to 75% to catch looser matches.</p>
        </div>
      )}

      {!scanning && groups.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] font-mono font-black uppercase tracking-widest text-zinc-500">
              {groups.length} cluster{groups.length === 1 ? '' : 's'} · {groups.reduce((s, g) => s + g.members.length, 0)} spellings · {mergedCount} track{mergedCount === 1 ? '' : 's'} merged
            </span>
          </div>
          {groups.map(group => {
            const isOpen = expanded.has(group.normalizedKey);
            const totalTracks = group.members.reduce((s, m) => s + m.count, 0);
            return (
              <div key={group.normalizedKey} className="bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden">
                {/* Cluster header */}
                <button
                  type="button"
                  onClick={() => setExpanded(prev => {
                    const next = new Set(prev);
                    next.has(group.normalizedKey) ? next.delete(group.normalizedKey) : next.add(group.normalizedKey);
                    return next;
                  })}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-900/50 transition-colors cursor-pointer text-left"
                >
                  <ChevronRight className={`w-3.5 h-3.5 text-zinc-500 transition-transform shrink-0 ${isOpen ? 'rotate-90' : ''}`} />
                  <span className="font-mono text-xs font-black text-zinc-200 truncate flex-1">
                    {group.members.map(m => m.name).join('  ≈  ')}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-gold/10 border border-gold/30 text-gold-bright text-[10px] font-mono font-black tabular-nums shrink-0">
                    {totalTracks} track{totalTracks === 1 ? '' : 's'}
                  </span>
                </button>

                {/* Cluster body */}
                {isOpen && (
                  <div className="px-3 pb-3 space-y-1.5 border-t border-zinc-900 pt-2">
                    {group.members.map((m, idx) => (
                      <div
                        key={m.name}
                        className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border ${
                          idx === 0
                            ? 'bg-moss/5 border-moss/30' // canonical (most tracks)
                            : 'bg-zinc-900 border-zinc-800'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {idx === 0 && <Check className="w-3 h-3 text-moss shrink-0" />}
                          <span className="text-xs font-mono font-bold text-zinc-200 truncate">{m.name}</span>
                          <span className="text-[9px] font-mono text-zinc-600 shrink-0">
                            {m.count} track{m.count === 1 ? '' : 's'}
                            {idx > 0 && ` — ${describeDifference(group.members[0].name, m.name)}`}
                          </span>
                        </div>
                        {idx > 0 && (
                          <button
                            type="button"
                            onClick={() => mergeGroup(group, m.name)}
                            className="px-2 py-1 rounded-md bg-zinc-800 hover:bg-indigo-ink/40 hover:border-indigo-bright/50 border border-zinc-700 text-[9px] font-mono font-black uppercase tracking-widest text-zinc-400 hover:text-gold-bright transition-all cursor-pointer shrink-0"
                            title={`Make "${m.name}" the canonical spelling for the whole cluster`}
                          >
                            Make canonical
                          </button>
                        )}
                      </div>
                    ))}
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => mergeGroup(group, group.members[0].name)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-moss hover:bg-brand-secondary-hover text-zinc-950 text-[10px] font-mono font-black uppercase tracking-widest transition-all cursor-pointer"
                      >
                        <Merge className="w-3 h-3" />
                        Merge all {totalTracks} tracks → "{group.members[0].name}"
                      </button>
                      <span className="text-[9px] font-mono text-zinc-600">
                        Rewrites the {field} field on every track in this cluster.
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!scanned && (
        <div className="text-center py-8 bg-zinc-950 border border-zinc-800 rounded-xl">
          <Fingerprint className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
          <p className="text-sm text-zinc-500 font-mono">Run a scan to cluster lookalike {field === 'artist' ? 'artists' : field === 'animeName' ? 'anime names' : 'titles'}.</p>
          <p className="text-[10px] text-zinc-600 font-mono mt-1">Or investigate a single name above without scanning.</p>
        </div>
      )}
    </div>
  );
}
