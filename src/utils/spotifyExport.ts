import { toast } from "sonner";
import { AnimeTrack } from "../types";

const SPOTIFY_CLIENT_ID = (import.meta as any).env?.VITE_SPOTIFY_CLIENT_ID;

export const exportToSpotifyPlaylist = async (
  playlistTitle: string,
  playlistDescription: string,
  tracks: AnimeTrack[]
) => {
  if (!SPOTIFY_CLIENT_ID) {
    toast.error("Spotify API integration requires VITE_SPOTIFY_CLIENT_ID in the environment to function.");
    return false;
  }

  // Very basic implementation: Note that real Spotify searching relies on fuzzy matching
  toast.info("Spotify API is currently stubbed due to OAuth redirect URI constraints in the preview environment. Configure your VITE_SPOTIFY_CLIENT_ID to enable.");
  return false;
};
