export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      food_order_items: {
        Row: {
          created_at: string
          id: string
          menu_item_id: string
          name: string
          order_id: string
          price: number
          quantity: number
        }
        Insert: {
          created_at?: string
          id?: string
          menu_item_id: string
          name: string
          order_id: string
          price: number
          quantity: number
        }
        Update: {
          created_at?: string
          id?: string
          menu_item_id?: string
          name?: string
          order_id?: string
          price?: number
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "food_order_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "food_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "food_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      food_orders: {
        Row: {
          created_at: string
          customer_id: string
          delivery_address: string
          delivery_boy_id: string | null
          delivery_lat: number | null
          delivery_lng: number | null
          id: string
          notes: string | null
          payment_method: string
          payment_status: string
          restaurant_id: string
          rider_lat: number | null
          rider_lng: number | null
          rider_location_updated_at: string | null
          status: Database["public"]["Enums"]["order_status"]
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          delivery_address: string
          delivery_boy_id?: string | null
          delivery_lat?: number | null
          delivery_lng?: number | null
          id?: string
          notes?: string | null
          payment_method?: string
          payment_status?: string
          restaurant_id: string
          rider_lat?: number | null
          rider_lng?: number | null
          rider_location_updated_at?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          total?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          delivery_address?: string
          delivery_boy_id?: string | null
          delivery_lat?: number | null
          delivery_lng?: number | null
          id?: string
          notes?: string | null
          payment_method?: string
          payment_status?: string
          restaurant_id?: string
          rider_lat?: number | null
          rider_lng?: number | null
          rider_location_updated_at?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "food_orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      grocery_items: {
        Row: {
          category: string | null
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_available: boolean
          name: string
          price: number
          store_id: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_available?: boolean
          name: string
          price: number
          store_id: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_available?: boolean
          name?: string
          price?: number
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grocery_items_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "grocery_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      grocery_order_items: {
        Row: {
          created_at: string
          grocery_item_id: string
          id: string
          name: string
          order_id: string
          price: number
          quantity: number
        }
        Insert: {
          created_at?: string
          grocery_item_id: string
          id?: string
          name: string
          order_id: string
          price: number
          quantity: number
        }
        Update: {
          created_at?: string
          grocery_item_id?: string
          id?: string
          name?: string
          order_id?: string
          price?: number
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "grocery_order_items_grocery_item_id_fkey"
            columns: ["grocery_item_id"]
            isOneToOne: false
            referencedRelation: "grocery_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grocery_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "grocery_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      grocery_orders: {
        Row: {
          created_at: string
          customer_id: string
          delivery_address: string
          delivery_boy_id: string | null
          delivery_lat: number | null
          delivery_lng: number | null
          id: string
          notes: string | null
          payment_method: string
          payment_status: string
          rider_lat: number | null
          rider_lng: number | null
          rider_location_updated_at: string | null
          status: Database["public"]["Enums"]["order_status"]
          store_id: string
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          delivery_address: string
          delivery_boy_id?: string | null
          delivery_lat?: number | null
          delivery_lng?: number | null
          id?: string
          notes?: string | null
          payment_method?: string
          payment_status?: string
          rider_lat?: number | null
          rider_lng?: number | null
          rider_location_updated_at?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          store_id: string
          total?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          delivery_address?: string
          delivery_boy_id?: string | null
          delivery_lat?: number | null
          delivery_lng?: number | null
          id?: string
          notes?: string | null
          payment_method?: string
          payment_status?: string
          rider_lat?: number | null
          rider_lng?: number | null
          rider_location_updated_at?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          store_id?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grocery_orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "grocery_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      grocery_stores: {
        Row: {
          address: string | null
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_open: boolean
          manager_id: string | null
          name: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_open?: boolean
          manager_id?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_open?: boolean
          manager_id?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      menu_items: {
        Row: {
          category: string | null
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_available: boolean
          is_veg: boolean
          name: string
          price: number
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_available?: boolean
          is_veg?: boolean
          name: string
          price: number
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_available?: boolean
          is_veg?: boolean
          name?: string
          price?: number
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      package_deliveries: {
        Row: {
          created_at: string
          customer_id: string
          drop_address: string
          drop_lat: number
          drop_lng: number
          fare_estimate: number | null
          id: string
          notes: string | null
          package_size: string
          payment_method: string
          payment_status: string
          pickup_address: string
          pickup_lat: number
          pickup_lng: number
          receiver_name: string | null
          receiver_phone: string | null
          rider_id: string | null
          rider_lat: number | null
          rider_lng: number | null
          rider_location_updated_at: string | null
          status: Database["public"]["Enums"]["ride_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          drop_address: string
          drop_lat: number
          drop_lng: number
          fare_estimate?: number | null
          id?: string
          notes?: string | null
          package_size?: string
          payment_method?: string
          payment_status?: string
          pickup_address: string
          pickup_lat: number
          pickup_lng: number
          receiver_name?: string | null
          receiver_phone?: string | null
          rider_id?: string | null
          rider_lat?: number | null
          rider_lng?: number | null
          rider_location_updated_at?: string | null
          status?: Database["public"]["Enums"]["ride_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          drop_address?: string
          drop_lat?: number
          drop_lng?: number
          fare_estimate?: number | null
          id?: string
          notes?: string | null
          package_size?: string
          payment_method?: string
          payment_status?: string
          pickup_address?: string
          pickup_lat?: number
          pickup_lng?: number
          receiver_name?: string | null
          receiver_phone?: string | null
          rider_id?: string | null
          rider_lat?: number | null
          rider_lng?: number | null
          rider_location_updated_at?: string | null
          status?: Database["public"]["Enums"]["ride_status"]
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      restaurants: {
        Row: {
          address: string | null
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_open: boolean
          manager_id: string | null
          name: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_open?: boolean
          manager_id?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_open?: boolean
          manager_id?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      rides: {
        Row: {
          created_at: string
          customer_id: string
          drop_address: string
          drop_lat: number
          drop_lng: number
          fare_estimate: number | null
          id: string
          notes: string | null
          payment_method: string
          payment_status: string
          pickup_address: string
          pickup_lat: number
          pickup_lng: number
          rider_id: string | null
          rider_lat: number | null
          rider_lng: number | null
          rider_location_updated_at: string | null
          status: Database["public"]["Enums"]["ride_status"]
          updated_at: string
          vehicle_type: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          drop_address: string
          drop_lat: number
          drop_lng: number
          fare_estimate?: number | null
          id?: string
          notes?: string | null
          payment_method?: string
          payment_status?: string
          pickup_address: string
          pickup_lat: number
          pickup_lng: number
          rider_id?: string | null
          rider_lat?: number | null
          rider_lng?: number | null
          rider_location_updated_at?: string | null
          status?: Database["public"]["Enums"]["ride_status"]
          updated_at?: string
          vehicle_type?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          drop_address?: string
          drop_lat?: number
          drop_lng?: number
          fare_estimate?: number | null
          id?: string
          notes?: string | null
          payment_method?: string
          payment_status?: string
          pickup_address?: string
          pickup_lat?: number
          pickup_lng?: number
          rider_id?: string | null
          rider_lat?: number | null
          rider_lng?: number | null
          rider_location_updated_at?: string | null
          status?: Database["public"]["Enums"]["ride_status"]
          updated_at?: string
          vehicle_type?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "customer"
        | "admin"
        | "hotel_manager"
        | "grocery_manager"
        | "delivery_boy"
        | "rider"
      order_status:
        | "pending"
        | "accepted"
        | "preparing"
        | "ready"
        | "picked_up"
        | "delivered"
        | "cancelled"
      ride_status:
        | "requested"
        | "accepted"
        | "started"
        | "completed"
        | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "customer",
        "admin",
        "hotel_manager",
        "grocery_manager",
        "delivery_boy",
        "rider",
      ],
      order_status: [
        "pending",
        "accepted",
        "preparing",
        "ready",
        "picked_up",
        "delivered",
        "cancelled",
      ],
      ride_status: [
        "requested",
        "accepted",
        "started",
        "completed",
        "cancelled",
      ],
    },
  },
} as const
