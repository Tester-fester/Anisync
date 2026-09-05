import React, { useState, useEffect } from 'react';
import { db } from '../utils/firebase';
import { collection, doc, getDocs, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { PokedexCollectible, AnimeTrack } from '../types';
import { Search, Plus, Trash2, Save, X, Edit, Box } from '@/utils/icons';
import { toast } from 'sonner';

interface AdminPokedexProps {
  allTracks: AnimeTrack[];
}

export const AdminPokedex: React.FC<AdminPokedexProps> = ({ allTracks }) => {
  const [collectibles, setCollectibles] = useState<PokedexCollectible[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingItem, setEditingItem] = useState<Partial<PokedexCollectible> | null>(null);
  
  const [searchTrack, setSearchTrack] = useState('');
  
  const fetchCollectibles = async () => {
    setLoading(true);
    try {
      const qs = await getDocs(collection(db, "pokedex_collectibles"));
      const items = qs.docs.map(d => ({ id: d.id, ...d.data() } as PokedexCollectible));
      setCollectibles(items);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCollectibles();
  }, []);

  const handleSave = async () => {
    if (!editingItem?.animeName || !editingItem?.id) return;
    try {
      const docRef = doc(db, "pokedex_collectibles", editingItem.id);
      const payload: any = { ...editingItem };
      if (!payload.createdAt) {
        payload.createdAt = Date.now(); // or serverTimestamp()
      }
      if (!payload.visualEffect) payload.visualEffect = 'none';
      if (!payload.iconType) payload.iconType = 'emoji';
      if (!payload.requiredTrackIds) payload.requiredTrackIds = [];
      
      await setDoc(docRef, payload);
      setEditingItem(null);
      fetchCollectibles();
      toast.success("Saved collectible!");
    } catch(err) {
      console.error(err);
      toast.error("Failed to save");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this collectible?")) return;
    try {
      await deleteDoc(doc(db, "pokedex_collectibles", id));
      fetchCollectibles();
    } catch(err) {
      console.error(err);
      toast.error("Failed to delete");
    }
  };

  const openForNew = () => {
    setEditingItem({
      id: '',
      animeName: '',
      description: '',
      iconType: 'emoji',
      iconValue: '⚔️',
      visualEffect: 'none',
      requiredTrackIds: []
    });
  };

  const addTrackToItem = (trackId: string) => {
    if (editingItem && editingItem.requiredTrackIds && !editingItem.requiredTrackIds.includes(trackId)) {
      setEditingItem({
        ...editingItem,
        requiredTrackIds: [...editingItem.requiredTrackIds, trackId]
      });
    }
  };

  const removeTrackFromItem = (trackId: string) => {
    if (editingItem && editingItem.requiredTrackIds) {
      setEditingItem({
        ...editingItem,
        requiredTrackIds: editingItem.requiredTrackIds.filter(id => id !== trackId)
      });
    }
  };

  const VISUAL_EFFECTS = [
    'none', 'glow-red', 'glow-blue', 'glow-purple', 'sparkle', 'holo', 'fire', 'void', 'cherry-blossom', 'gold-shine'
  ];

  return (
    <div className="p-4 max-w-5xl mx-auto text-white space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Box className="w-6 h-6 text-brand-primary" />
          Pokedex Collectibles Admin
        </h2>
        <button 
          onClick={openForNew}
          className="flex items-center gap-2 bg-brand-primary text-black px-4 py-2 rounded-lg font-bold hover:bg-brand-primary/80 transition-colors"
        >
          <Plus className="w-5 h-5" />
          Create New
        </button>
      </div>

      {editingItem && (
        <div className="bg-panel-bg border border-panel-border p-6 rounded-xl space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-semibold">
              {collectibles.find(c => c.id === editingItem.id) ? 'Edit Collectible' : 'New Collectible'}
            </h3>
            <button onClick={() => setEditingItem(null)} className="text-gray-400 hover:text-white">
              <X className="w-6 h-6" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">ID (unique, e.g. attack-on-titan)</label>
              <input 
                type="text" 
                value={editingItem.id || ''} 
                className="w-full bg-black/50 border border-white/10 rounded-lg p-2 text-white"
                onChange={e => setEditingItem({...editingItem, id: e.target.value.toLowerCase().replace(/\s+/g, '-')})}
                disabled={!!collectibles.find(c => c.id === editingItem.id)} // disable if exists
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Anime Name</label>
              <input 
                type="text" 
                value={editingItem.animeName || ''} 
                className="w-full bg-black/50 border border-white/10 rounded-lg p-2 text-white"
                onChange={e => setEditingItem({...editingItem, animeName: e.target.value})}
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-400 mb-1">Description</label>
              <textarea 
                value={editingItem.description || ''} 
                className="w-full bg-black/50 border border-white/10 rounded-lg p-2 text-white h-24"
                onChange={e => setEditingItem({...editingItem, description: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Icon Type</label>
              <select 
                value={editingItem.iconType || 'emoji'} 
                className="w-full bg-black/50 border border-white/10 rounded-lg p-2 text-white"
                onChange={e => setEditingItem({...editingItem, iconType: e.target.value as any})}
              >
                <option value="emoji">Emoji</option>
                <option value="image">Image URL</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Icon Value (Emoji or URL)</label>
              <input 
                type="text" 
                value={editingItem.iconValue || ''} 
                className="w-full bg-black/50 border border-white/10 rounded-lg p-2 text-white"
                onChange={e => setEditingItem({...editingItem, iconValue: e.target.value})}
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-400 mb-1">Visual Effect</label>
              <select 
                value={editingItem.visualEffect || 'none'} 
                className="w-full bg-black/50 border border-white/10 rounded-lg p-2 text-white"
                onChange={e => setEditingItem({...editingItem, visualEffect: e.target.value as any})}
              >
                {VISUAL_EFFECTS.map(effect => (
                  <option key={effect} value={effect}>{effect}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="border border-white/10 rounded-xl p-4 bg-black/20">
            <h4 className="font-semibold mb-2 flex items-center gap-2">
              <Search className="w-4 h-4 text-gray-400" />
              Required Tracks to Unlock ({editingItem.requiredTrackIds?.length || 0})
            </h4>
            
            <div className="mt-4 border-t border-white/10 pt-4 flex flex-col md:flex-row gap-4">
              <div className="flex-1 space-y-2">
                <input 
                  type="text" 
                  placeholder="Search tracks to add..." 
                  value={searchTrack}
                  onChange={e => setSearchTrack(e.target.value)}
                  className="w-full bg-black/50 border border-white/10 rounded-lg p-2 text-white"
                />
                <div className="max-h-40 overflow-y-auto space-y-1 bg-black/30 rounded border border-white/5 p-1">
                  {searchTrack.length > 2 ? allTracks.filter(t => 
                    t.title.toLowerCase().includes(searchTrack.toLowerCase()) || 
                    t.animeName.toLowerCase().includes(searchTrack.toLowerCase())
                  ).slice(0, 50).map(t => (
                    <div key={t.id} className="flex items-center justify-between p-2 hover:bg-white/10 rounded text-sm group">
                      <div className="truncate flex-1">
                        <span className="font-medium text-white">{t.title}</span>
                        <span className="text-gray-400 ml-2 text-xs">{t.animeName}</span>
                      </div>
                      <button 
                        onClick={() => addTrackToItem(t.id)}
                        disabled={editingItem.requiredTrackIds?.includes(t.id)}
                        className="ml-2 bg-brand-primary/20 text-brand-primary p-1 rounded hover:bg-brand-primary hover:text-black disabled:opacity-50"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  )) : (
                    <div className="text-center text-gray-500 text-sm py-4">Type to search tracks...</div>
                  )}
                </div>
              </div>

              <div className="flex-1 space-y-1 bg-black/30 rounded border border-white/5 p-1 max-h-52 overflow-y-auto">
                <div className="text-xs font-semibold text-gray-400 p-2 uppercase tracking-wider">Currently Required:</div>
                {editingItem.requiredTrackIds?.map(tid => {
                  const t = allTracks.find(x => x.id === tid);
                  return (
                    <div key={tid} className="flex items-center justify-between p-2 bg-white/5 rounded text-sm">
                      <div className="truncate flex-1">
                        <span className="font-medium text-white">{t?.title || tid}</span>
                        {t && <span className="text-gray-400 ml-2 text-xs">{t.animeName}</span>}
                      </div>
                      <button 
                        onClick={() => removeTrackFromItem(tid)}
                        className="ml-2 text-vermillion hover:text-vermillion-tint p-1"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
                {editingItem.requiredTrackIds?.length === 0 && (
                  <div className="text-center text-gray-500 text-sm py-8">No tracks required yet.</div>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
            <button 
              onClick={() => setEditingItem(null)}
              className="px-4 py-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5"
            >
              Cancel
            </button>
            <button 
              onClick={handleSave}
              className="px-4 py-2 rounded-lg bg-moss text-zinc-950 font-bold flex items-center gap-2 hover:bg-brand-secondary-hover"
            >
              <Save className="w-4 h-4" />
              Save Collectible
            </button>
          </div>
        </div>
      )}

      {!loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {collectibles.map(item => (
            <div key={item.id} className="bg-panel-bg border border-panel-border p-4 rounded-xl flex flex-col hover:border-brand-primary/50 transition-colors">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-black/50 rounded-lg flex items-center justify-center text-2xl border border-white/10 shrink-0">
                    {item.iconType === 'emoji' ? item.iconValue : <img src={item.iconValue} alt="" className="w-8 h-8 object-contain" />}
                  </div>
                  <div>
                    <h4 className="font-bold text-white leading-tight">{item.animeName}</h4>
                    <span className="text-xs text-gray-400">{item.id}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setEditingItem(item)} className="p-1.5 text-gold-bright hover:bg-gold-bright/10 rounded">
                    <Edit className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleDelete(item.id)} className="p-1.5 text-vermillion hover:bg-vermillion/10 rounded">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              
              <div className="flex-1 text-sm text-gray-300 mb-4 line-clamp-2">
                {item.description}
              </div>
              
              <div className="mt-auto flex items-center justify-between text-xs pt-3 border-t border-white/5">
                <span className="text-gray-400 block px-2 py-1 bg-white/5 rounded-full">
                  Requirements: <span className="font-bold text-white">{item.requiredTrackIds?.length || 0} tracks</span>
                </span>
                {item.visualEffect && item.visualEffect !== 'none' && (
                  <span className="text-brand-primary flex items-center gap-1">
                    Effect: {item.visualEffect}
                  </span>
                )}
              </div>
            </div>
          ))}
          {collectibles.length === 0 && (
            <div className="col-span-full py-12 text-center text-gray-500 bg-white/5 rounded-xl border border-white/10">
              No collectibles created yet. Click "Create New" to start your Pokedex!
            </div>
          )}
        </div>
      ) : (
        <div className="py-20 text-center text-brand-primary flex flex-col items-center justify-center">
          <div className="w-8 h-8 border-2 border-brand-primary/20 border-t-brand-primary rounded-full animate-spin"></div>
          <span className="mt-4">Loading pokedex...</span>
        </div>
      )}
    </div>
  );
};
