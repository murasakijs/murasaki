import { create } from 'zustand'

interface CounterState {
  count: number
  increment: () => void
  reset: () => void
}

/** A tiny shared store so the counter's actions can be reused from anywhere. */
export const useCounter = create<CounterState>((set) => ({
  count: 0,
  increment: () => set((s) => ({ count: s.count + 1 })),
  reset: () => set({ count: 0 }),
}))
