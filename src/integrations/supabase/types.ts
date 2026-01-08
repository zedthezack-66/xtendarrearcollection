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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      batch_customers: {
        Row: {
          amount_owed: number
          assigned_agent_id: string | null
          batch_id: string
          created_at: string
          id: string
          master_customer_id: string
          mobile_number: string | null
          name: string
          nrc_number: string
        }
        Insert: {
          amount_owed?: number
          assigned_agent_id?: string | null
          batch_id: string
          created_at?: string
          id?: string
          master_customer_id: string
          mobile_number?: string | null
          name: string
          nrc_number: string
        }
        Update: {
          amount_owed?: number
          assigned_agent_id?: string | null
          batch_id?: string
          created_at?: string
          id?: string
          master_customer_id?: string
          mobile_number?: string | null
          name?: string
          nrc_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "batch_customers_assigned_agent_id_fkey"
            columns: ["assigned_agent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_customers_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_customers_master_customer_id_fkey"
            columns: ["master_customer_id"]
            isOneToOne: false
            referencedRelation: "master_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      batches: {
        Row: {
          created_at: string
          customer_count: number
          id: string
          institution_name: string
          name: string
          total_amount: number
          upload_date: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          customer_count?: number
          id?: string
          institution_name: string
          name: string
          total_amount?: number
          upload_date?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          customer_count?: number
          id?: string
          institution_name?: string
          name?: string
          total_amount?: number
          upload_date?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      call_logs: {
        Row: {
          agent_id: string
          call_outcome: string
          created_at: string
          id: string
          master_customer_id: string
          notes: string | null
          promise_to_pay_amount: number | null
          promise_to_pay_date: string | null
          ticket_id: string
        }
        Insert: {
          agent_id: string
          call_outcome: string
          created_at?: string
          id?: string
          master_customer_id: string
          notes?: string | null
          promise_to_pay_amount?: number | null
          promise_to_pay_date?: string | null
          ticket_id: string
        }
        Update: {
          agent_id?: string
          call_outcome?: string
          created_at?: string
          id?: string
          master_customer_id?: string
          notes?: string | null
          promise_to_pay_amount?: number | null
          promise_to_pay_date?: string | null
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_logs_master_customer_id_fkey"
            columns: ["master_customer_id"]
            isOneToOne: false
            referencedRelation: "master_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_logs_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      master_customers: {
        Row: {
          assigned_agent: string | null
          call_notes: string | null
          created_at: string
          id: string
          loan_account_number: string | null
          mobile_number: string | null
          name: string
          nrc_number: string
          outstanding_balance: number
          payment_status: string
          total_owed: number
          total_paid: number
          updated_at: string
        }
        Insert: {
          assigned_agent?: string | null
          call_notes?: string | null
          created_at?: string
          id?: string
          loan_account_number?: string | null
          mobile_number?: string | null
          name: string
          nrc_number: string
          outstanding_balance?: number
          payment_status?: string
          total_owed?: number
          total_paid?: number
          updated_at?: string
        }
        Update: {
          assigned_agent?: string | null
          call_notes?: string | null
          created_at?: string
          id?: string
          loan_account_number?: string | null
          mobile_number?: string | null
          name?: string
          nrc_number?: string
          outstanding_balance?: number
          payment_status?: string
          total_owed?: number
          total_paid?: number
          updated_at?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          customer_name: string
          id: string
          master_customer_id: string
          notes: string | null
          payment_date: string
          payment_method: string
          recorded_by: string | null
          ticket_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          customer_name: string
          id?: string
          master_customer_id: string
          notes?: string | null
          payment_date?: string
          payment_method: string
          recorded_by?: string | null
          ticket_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          customer_name?: string
          id?: string
          master_customer_id?: string
          notes?: string | null
          payment_date?: string
          payment_method?: string
          recorded_by?: string | null
          ticket_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_master_customer_id_fkey"
            columns: ["master_customer_id"]
            isOneToOne: false
            referencedRelation: "master_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          full_name: string
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          full_name: string
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          full_name?: string
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      tickets: {
        Row: {
          amount_owed: number
          assigned_agent: string | null
          batch_id: string | null
          call_notes: string | null
          created_at: string
          customer_name: string
          id: string
          master_customer_id: string
          mobile_number: string | null
          nrc_number: string
          priority: string
          resolved_date: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_owed?: number
          assigned_agent?: string | null
          batch_id?: string | null
          call_notes?: string | null
          created_at?: string
          customer_name: string
          id?: string
          master_customer_id: string
          mobile_number?: string | null
          nrc_number: string
          priority?: string
          resolved_date?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount_owed?: number
          assigned_agent?: string | null
          batch_id?: string | null
          call_notes?: string | null
          created_at?: string
          customer_name?: string
          id?: string
          master_customer_id?: string
          mobile_number?: string | null
          nrc_number?: string
          priority?: string
          resolved_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tickets_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_master_customer_id_fkey"
            columns: ["master_customer_id"]
            isOneToOne: false
            referencedRelation: "master_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
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
      admin_delete_user: { Args: { p_user_id: string }; Returns: Json }
      clear_all_data: { Args: never; Returns: Json }
      get_admin_agent_analytics: {
        Args: { p_agent_id?: string }
        Returns: Json
      }
      get_collections_by_agent: { Args: { p_batch_id?: string }; Returns: Json }
      get_dashboard_stats: {
        Args: { p_agent_id?: string; p_batch_id?: string }
        Returns: Json
      }
      get_interaction_analytics: {
        Args: {
          p_agent_id?: string
          p_end_date?: string
          p_start_date?: string
        }
        Returns: Json
      }
      get_recent_tickets: {
        Args: {
          p_batch_id?: string
          p_limit?: number
          p_offset?: number
          p_status?: string
        }
        Returns: Json
      }
      get_top_defaulters: {
        Args: { p_batch_id?: string; p_limit?: number; p_offset?: number }
        Returns: Json
      }
      get_weekly_report_stats: { Args: { p_agent_id?: string }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      safe_delete_batch: {
        Args: { p_archive?: boolean; p_batch_id: string; p_chunk_size?: number }
        Returns: Json
      }
      update_user_role: {
        Args: {
          p_new_role: Database["public"]["Enums"]["app_role"]
          p_target_user_id: string
        }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin" | "agent"
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
      app_role: ["admin", "agent"],
    },
  },
} as const
