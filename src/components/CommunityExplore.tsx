import React from 'react';
import { UserAccount } from '../types';
import { Users, Award, Trophy, Music } from '@/utils/icons';
import { motion } from 'motion/react';

interface CommunityExploreProps {
  userProfiles: UserAccount[];
  onViewProfile: (profileId: string) => void;
}

export default function CommunityExplore({ userProfiles, onViewProfile }: CommunityExploreProps) {
  // Sort users by some metric for 'popular' or just show all
  const sortedUsers = [...userProfiles].sort((a, b) => (b.votesCount || 0) - (a.votesCount || 0));

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-zinc-900">
        <div>
          <h2 className="text-xl font-display font-black text-white uppercase tracking-tight flex items-center gap-2">
            <Users className="w-5 h-5 text-vermillion" />
            Community Curators
          </h2>
          <p className="text-zinc-500 font-mono text-[11px] mt-1 uppercase tracking-wider">
            Explore databanks, custom playlists and arena statistics of other cataloguers.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sortedUsers.map(user => (
          <motion.div
            key={user.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col bg-zinc-950/60 border border-zinc-900 hover:border-vermillion/30 rounded-xl overflow-hidden cursor-pointer transition-all hover:bg-zinc-900 group"
            onClick={() => onViewProfile(user.id)}
          >
            <div className="flex items-start gap-4 p-4">
               {user.picture ? (
                 <img src={user.picture} className="w-12 h-12 rounded-lg border border-zinc-800" referrerPolicy="no-referrer" />
               ) : (
                 <div className="w-12 h-12 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                   <Users className="w-5 h-5 text-zinc-600" />
                 </div>
               )}
               <div className="flex-1 min-w-0">
                 <h3 className="text-sm font-black text-white truncate flex items-center gap-1.5">
                   {user.username}
                   {user.role === 'admin' && (
                     <span className="px-1.5 py-0.5 rounded bg-rose-deep/20 text-vermillion-tint text-[11px] font-mono uppercase tracking-widest border border-rose-deep/30">Admin</span>
                   )}
                 </h3>
                 <p className="text-[11px] text-zinc-500 font-mono uppercase mt-0.5 truncate">{user.bio || 'No bio provided'}</p>
                 <div className="flex flex-wrap gap-2 mt-2">
                    <div className="flex items-center gap-1 text-[11px] font-mono text-zinc-400">
                      <Trophy className="w-3 h-3 text-gold" />
                      {user.votesCount || 0} Votes
                    </div>
                    {user.customLists && user.customLists.length > 0 && (
                      <div className="flex items-center gap-1 text-[11px] font-mono text-zinc-400">
                        <Music className="w-3 h-3 text-vermillion" />
                        {user.customLists.length} Lists
                      </div>
                    )}
                 </div>
               </div>
            </div>
          </motion.div>
        ))}
        
        {sortedUsers.length === 0 && (
          <div className="col-span-full py-12 text-center text-zinc-500 font-mono text-xs uppercase flex flex-col items-center justify-center border border-dashed border-zinc-900 rounded-xl bg-zinc-950/20">
            <Users className="w-8 h-8 text-zinc-800 mb-2" />
            No profiles indexed yet.
          </div>
        )}
      </div>
    </div>
  );
}
