import { toast } from "sonner";
import { getAccessToken, initAuth, googleSignIn } from "./firebase";
import { AnimeTrack } from "../types";

export const exportToYouTubePlaylist = async (
  playlistTitle: string,
  playlistDescription: string,
  tracks: AnimeTrack[]
) => {
  try {
    let token = await getAccessToken();
    if (!token) {
      toast.info("Signing in to YouTube...");
      const result = await googleSignIn();
      if (result) {
        token = result.accessToken;
      } else {
        throw new Error("Failed to sign in to YouTube");
      }
    }

    toast.loading("Creating playlist...", { id: "yt-export" });

    // 1. Create Playlist
    const createRes = await fetch("https://www.googleapis.com/youtube/v3/playlists?part=snippet,status", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        snippet: {
          title: playlistTitle,
          description: playlistDescription
        },
        status: {
          privacyStatus: "private" // default private
        }
      })
    });

    if (!createRes.ok) {
      const errBody = await createRes.json();
      throw new Error(errBody.error?.message || "Failed to create YouTube playlist");
    }

    const playlist = await createRes.json();
    const playlistId = playlist.id;

    toast.loading("Adding tracks... (0/" + tracks.length + ")", { id: "yt-export" });

    // 2. Add Tracks (youtubeIds)
    let addedCount = 0;
    for (const track of tracks) {
      if (!track.youtubeId) continue;
      
      const addRes = await fetch("https://www.googleapis.com/youtube/v3/playlistItems?part=snippet", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          snippet: {
            playlistId: playlistId,
            resourceId: {
              kind: "youtube#video",
              videoId: track.youtubeId
            }
          }
        })
      });

      if (addRes.ok) {
        addedCount++;
        toast.loading(`Adding tracks... (${addedCount}/${tracks.length})`, { id: "yt-export" });
      } else {
        console.error("Failed to add track to YT playlist", await addRes.json());
      }
    }

    toast.success(`Exported ${addedCount} tracks to YouTube!`, { id: "yt-export" });
    
    // Open in new tab
    window.open(`https://www.youtube.com/playlist?list=${playlistId}`, '_blank');
  } catch (error: any) {
    console.error(error);
    toast.error(`YouTube Export Failed: ${error.message}`, { id: "yt-export" });
  }
};
