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
      agent_notifications: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          is_read: boolean
          message: string
          related_customer_id: string | null
          related_ticket_id: string | null
          title: string
          type: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          is_read?: boolean
          message: string
          related_customer_id?: string | null
          related_ticket_id?: string | null
          title: string
          type?: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          related_customer_id?: string | null
          related_ticket_id?: string | null
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_notifications_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_notifications_related_customer_id_fkey"
            columns: ["related_customer_id"]
            isOneToOne: false
            referencedRelation: "master_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_notifications_related_ticket_id_fkey"
            columns: ["related_ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      amount_owed_audit_logs: {
        Row: {
          changed_by: string
          created_at: string
          id: string
          master_customer_id: string
          new_amount: number
          notes: string | null
          old_amount: number
          source: string
          ticket_id: string
        }
        Insert: {
          changed_by: string
          created_at?: string
          id?: string
          master_customer_id: string
          new_amount: number
          notes?: string | null
          old_amount: number
          source?: string
          ticket_id: string
        }
        Update: {
          changed_by?: string
          created_at?: string
          id?: string
          master_customer_id?: string
          new_amount?: number
          notes?: string | null
          old_amount?: number
          source?: string
          ticket_id?: string
        }
        Relationships: []
      }
      arrears_sync_logs: {
        Row: {
          admin_user_id: string
          created_at: string
          id: string
          loan_book_payment_date: string | null
          master_customer_id: string | null
          movement_type: string
          new_arrears: number
          nrc_number: string
          old_arrears: number
          source: string | null
          sync_batch_id: string
          ticket_resolved: boolean | null
        }
        Insert: {
          admin_user_id: string
          created_at?: string
          id?: string
          loan_book_payment_date?: string | null
          master_customer_id?: string | null
          movement_type: string
          new_arrears?: number
          nrc_number: string
          old_arrears?: number
          source?: string | null
          sync_batch_id: string
          ticket_resolved?: boolean | null
        }
        Update: {
          admin_user_id?: string
          created_at?: string
          id?: string
          loan_book_payment_date?: string | null
          master_customer_id?: string | null
          movement_type?: string
          new_arrears?: number
          nrc_number?: string
          old_arrears?: number
          source?: string | null
          sync_batch_id?: string
          ticket_resolved?: boolean | null
        }
        Relationships: []
      }
      batch_customers: {
        Row: {
          amount_owed: number
          arrear_status: string | null
          assigned_agent_id: string | null
          batch_id: string
          branch_name: string | null
          created_at: string
          employer_name: string | null
          employer_subdivision: string | null
          id: string
          last_payment_date: string | null
          loan_consultant: string | null
          master_customer_id: string
          mobile_number: string | null
          name: string
          nrc_number: string
          reason_for_arrears: string | null
          tenure: string | null
        }
        Insert: {
          amount_owed?: number
          arrear_status?: string | null
          assigned_agent_id?: string | null
          batch_id: string
          branch_name?: string | null
          created_at?: string
          employer_name?: string | null
          employer_subdivision?: string | null
          id?: string
          last_payment_date?: string | null
          loan_consultant?: string | null
          master_customer_id: string
          mobile_number?: string | null
          name: string
          nrc_number: string
          reason_for_arrears?: string | null
          tenure?: string | null
        }
        Update: {
          amount_owed?: number
          arrear_status?: string | null
          assigned_agent_id?: string | null
          batch_id?: string
          branch_name?: string | null
          created_at?: string
          employer_name?: string | null
          employer_subdivision?: string | null
          id?: string
          last_payment_date?: string | null
          loan_consultant?: string | null
          master_customer_id?: string
          mobile_number?: string | null
          name?: string
          nrc_number?: string
          reason_for_arrears?: string | null
          tenure?: string | null
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
          arrear_status: string | null
          assigned_agent: string | null
          branch_name: string | null
          call_notes: string | null
          created_at: string
          employer_name: string | null
          employer_subdivision: string | null
          id: string
          last_payment_date: string | null
          loan_account_number: string | null
          loan_book_arrears: number | null
          loan_book_last_payment_date: string | null
          loan_consultant: string | null
          mobile_number: string | null
          name: string
          next_of_kin_contact: string | null
          next_of_kin_name: string | null
          nrc_number: string
          outstanding_balance: number
          payment_status: string
          reason_for_arrears: string | null
          tenure: string | null
          total_owed: number
          total_paid: number
          updated_at: string
          workplace_contact: string | null
          workplace_destination: string | null
        }
        Insert: {
          arrear_status?: string | null
          assigned_agent?: string | null
          branch_name?: string | null
          call_notes?: string | null
          created_at?: string
          employer_name?: string | null
          employer_subdivision?: string | null
          id?: string
          last_payment_date?: string | null
          loan_account_number?: string | null
          loan_book_arrears?: number | null
          loan_book_last_payment_date?: string | null
          loan_consultant?: string | null
          mobile_number?: string | null
          name: string
          next_of_kin_contact?: string | null
          next_of_kin_name?: string | null
          nrc_number: string
          outstanding_balance?: number
          payment_status?: string
          reason_for_arrears?: string | null
          tenure?: string | null
          total_owed?: number
          total_paid?: number
          updated_at?: string
          workplace_contact?: string | null
          workplace_destination?: string | null
        }
        Update: {
          arrear_status?: string | null
          assigned_agent?: string | null
          branch_name?: string | null
          call_notes?: string | null
          created_at?: string
          employer_name?: string | null
          employer_subdivision?: string | null
          id?: string
          last_payment_date?: string | null
          loan_account_number?: string | null
          loan_book_arrears?: number | null
          loan_book_last_payment_date?: string | null
          loan_consultant?: string | null
          mobile_number?: string | null
          name?: string
          next_of_kin_contact?: string | null
          next_of_kin_name?: string | null
          nrc_number?: string
          outstanding_balance?: number
          payment_status?: string
          reason_for_arrears?: string | null
          tenure?: string | null
          total_owed?: number
          total_paid?: number
          updated_at?: string
          workplace_contact?: string | null
          workplace_destination?: string | null
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
          source: string
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
          source?: string
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
          source?: string
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
          employer_reason_for_arrears: string | null
          id: string
          master_customer_id: string
          mobile_number: string | null
          nrc_number: string
          priority: string
          resolved_date: string | null
          status: string
          ticket_arrear_status: string | null
          ticket_payment_status: string | null
          updated_at: string
        }
        Insert: {
          amount_owed?: number
          assigned_agent?: string | null
          batch_id?: string | null
          call_notes?: string | null
          created_at?: string
          customer_name: string
          employer_reason_for_arrears?: string | null
          id?: string
          master_customer_id: string
          mobile_number?: string | null
          nrc_number: string
          priority?: string
          resolved_date?: string | null
          status?: string
          ticket_arrear_status?: string | null
          ticket_payment_status?: string | null
          updated_at?: string
        }
        Update: {
          amount_owed?: number
          assigned_agent?: string | null
          batch_id?: string | null
          call_notes?: string | null
          created_at?: string
          customer_name?: string
          employer_reason_for_arrears?: string | null
          id?: string
          master_customer_id?: string
          mobile_number?: string | null
          nrc_number?: string
          priority?: string
          resolved_date?: string | null
          status?: string
          ticket_arrear_status?: string | null
          ticket_payment_status?: string | null
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
      bulk_transfer_clients: {
        Args: { p_target_agent_id: string; p_ticket_ids: string[] }
        Returns: Json
      }
      clear_all_data: { Args: never; Returns: Json }
      create_arrears_snapshots: {
        Args: { p_source?: string; p_sync_batch_id: string }
        Returns: Json
      }
      get_admin_agent_analytics: {
        Args: { p_agent_id?: string }
        Returns: Json
      }
      get_admin_full_export: {
        Args: {
          p_agent_id?: string
          p_batch_id?: string
          p_end_date?: string
          p_export_type?: string
          p_filter?: string
          p_limit?: number
          p_offset?: number
          p_start_date?: string
          p_worked_only?: boolean
        }
        Returns: Json
      }
      get_arrears_movement_analytics:
        | {
            Args: {
              p_agent_id?: string
              p_end_date?: string
              p_start_date?: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_agent_id?: string
              p_end_date?: string
              p_start_date?: string
            }
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
      get_loan_book_sync_template: { Args: never; Returns: Json }
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
      hard_delete_ticket: { Args: { p_ticket_id: string }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      process_batch_arrears_update: {
        Args: { p_batch_id: string; p_updates: Json }
        Returns: Json
      }
      process_daily_loan_book_update: {
        Args: { p_batch_id: string; p_sync_data: string }
        Returns: Json
      }
      process_loan_book_sync: { Args: { p_sync_data: string }; Returns: Json }
      safe_delete_batch: {
        Args: { p_archive?: boolean; p_batch_id: string; p_chunk_size?: number }
        Returns: Json
      }
      transfer_client_to_batch: {
        Args: {
          p_target_agent_id: string
          p_target_batch_id: string
          p_ticket_id: string
        }
        Returns: Json
      }
      update_amount_owed: {
        Args: {
          p_new_amount: number
          p_notes?: string
          p_source?: string
          p_ticket_id: string
        }
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
