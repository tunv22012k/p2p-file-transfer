import { TransferHistoryItem } from '@/types/webrtc';

const STORAGE_KEY = 'p2p_transfer_history';
const MAX_HISTORY_ITEMS = 50;

export const historyUtil = {
  getHistory(): TransferHistoryItem[] {
    if (typeof window === 'undefined') {
      return [];
    }
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('Failed to load history', e);
      return [];
    }
  },

  addEntry(entry: Omit<TransferHistoryItem, 'id' | 'timestamp'>): TransferHistoryItem {
    const history = this.getHistory();
    const newEntry: TransferHistoryItem = {
      ...entry,
      id: Math.random().toString(36).slice(2, 11),
      timestamp: Date.now(),
    };

    const newHistory = [newEntry, ...history].slice(0, MAX_HISTORY_ITEMS);

    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newHistory));
      // Dispatch a custom event to notify other components of history changes
      window.dispatchEvent(new Event('transfer-history-updated'));
    }

    return newEntry;
  },

  clearHistory() {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
      window.dispatchEvent(new Event('transfer-history-updated'));
    }
  }
};
