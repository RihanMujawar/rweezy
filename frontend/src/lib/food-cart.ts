import { create } from "zustand";

export type CartItem = {
  id: string;
  name: string;
  price: number;
  quantity: number;
  restaurantId: string;
};

interface CartState {
  items: CartItem[];
  restaurantId: string | null;
  add: (item: Omit<CartItem, "quantity">) => void;
  remove: (id: string) => void;
  setQty: (id: string, q: number) => void;
  clear: () => void;
  total: () => number;
}

export const useFoodCart = create<CartState>((set, get) => ({
  items: [],
  restaurantId: null,
  add: (item) =>
    set((state) => {
      // enforce single-restaurant cart
      if (state.restaurantId && state.restaurantId !== item.restaurantId) {
        return { items: [{ ...item, quantity: 1 }], restaurantId: item.restaurantId };
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
      return { items: [...state.items, { ...item, quantity: 1 }], restaurantId: item.restaurantId };
    }),
  remove: (id) =>
    set((state) => {
      const items = state.items.filter((i) => i.id !== id);
      return { items, restaurantId: items.length === 0 ? null : state.restaurantId };
    }),
  setQty: (id, q) =>
    set((state) => ({
      ...state,
      items: state.items
        .map((i) => (i.id === id ? { ...i, quantity: Math.max(0, q) } : i))
        .filter((i) => i.quantity > 0),
    })),
  clear: () => set({ items: [], restaurantId: null }),
  total: () => get().items.reduce((s, i) => s + i.price * i.quantity, 0),
}));
