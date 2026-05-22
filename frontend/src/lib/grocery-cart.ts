import { create } from "zustand";

export type GroceryCartItem = {
  id: string;
  name: string;
  price: number;
  quantity: number;
  storeId: string;
};

interface CartState {
  items: GroceryCartItem[];
  storeId: string | null;
  add: (item: Omit<GroceryCartItem, "quantity">) => void;
  remove: (id: string) => void;
  setQty: (id: string, q: number) => void;
  clear: () => void;
  total: () => number;
}

export const useGroceryCart = create<CartState>((set, get) => ({
  items: [],
  storeId: null,
  add: (item) =>
    set((state) => {
      if (state.storeId && state.storeId !== item.storeId) {
        return { items: [{ ...item, quantity: 1 }], storeId: item.storeId };
      }
      const existing = state.items.find((i) => i.id === item.id);
      if (existing) {
        return {
          ...state,
          items: state.items.map((i) =>
            i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i,
          ),
        };
      }
      return { items: [...state.items, { ...item, quantity: 1 }], storeId: item.storeId };
    }),
  remove: (id) =>
    set((state) => {
      const items = state.items.filter((i) => i.id !== id);
      return { items, storeId: items.length === 0 ? null : state.storeId };
    }),
  setQty: (id, q) =>
    set((state) => ({
      ...state,
      items: state.items
        .map((i) => (i.id === id ? { ...i, quantity: Math.max(0, q) } : i))
        .filter((i) => i.quantity > 0),
    })),
  clear: () => set({ items: [], storeId: null }),
  total: () => get().items.reduce((s, i) => s + i.price * i.quantity, 0),
}));
