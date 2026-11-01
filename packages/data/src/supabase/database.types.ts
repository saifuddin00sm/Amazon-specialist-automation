
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "ad_groups": {
                  Row: {
                    "campaign_id": string,"default_bid": number,"id": string,"name": string,"product_ids": (string)[],"seller_account_id": string,"state": Database["public"]['Enums']["ad_state"],"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "campaign_id": string,"default_bid": number,"id": string,"name": string,"product_ids": (string)[],"seller_account_id": string,"state": Database["public"]['Enums']["ad_state"],"workspace_id": string
                  }
                  Update: {
                    "campaign_id"?: string,"default_bid"?: number,"id"?: string,"name"?: string,"product_ids"?: (string)[],"seller_account_id"?: string,"state"?: Database["public"]['Enums']["ad_state"],"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ad_groups_campaign_id_seller_account_id_workspace_id_fkey"
      columns: ["campaign_id","seller_account_id","workspace_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id","seller_account_id","workspace_id"]
    }
                  ]
                },"agent_runs": {
                  Row: {
                    "agent": Database["public"]['Enums']["agent_name"],"autonomy_level": Database["public"]['Enums']["autonomy_level"],"error": string | null,"finished_at": string | null,"id": string,"proposal_ids": (string)[],"seller_account_id": string,"started_at": string,"status": Database["public"]['Enums']["agent_run_status"],"steps": Json | null,"subject_id": string | null,"subject_type": Database["public"]['Enums']["entity_type"] | null,"summary": string,"trigger": Database["public"]['Enums']["agent_run_trigger"],"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agent": Database["public"]['Enums']["agent_name"],"autonomy_level": Database["public"]['Enums']["autonomy_level"],"error"?: string | null,"finished_at"?: string | null,"id": string,"proposal_ids"?: (string)[],"seller_account_id": string,"started_at": string,"status": Database["public"]['Enums']["agent_run_status"],"steps"?: Json | null,"subject_id"?: string | null,"subject_type"?: Database["public"]['Enums']["entity_type"] | null,"summary"?: string,"trigger": Database["public"]['Enums']["agent_run_trigger"],"workspace_id": string
                  }
                  Update: {
                    "agent"?: Database["public"]['Enums']["agent_name"],"autonomy_level"?: Database["public"]['Enums']["autonomy_level"],"error"?: string | null,"finished_at"?: string | null,"id"?: string,"proposal_ids"?: (string)[],"seller_account_id"?: string,"started_at"?: string,"status"?: Database["public"]['Enums']["agent_run_status"],"steps"?: Json | null,"subject_id"?: string | null,"subject_type"?: Database["public"]['Enums']["entity_type"] | null,"summary"?: string,"trigger"?: Database["public"]['Enums']["agent_run_trigger"],"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "agent_runs_seller_account_id_workspace_id_fkey"
      columns: ["seller_account_id","workspace_id"]
isOneToOne: false
      referencedRelation: "seller_accounts"
      referencedColumns: ["id","workspace_id"]
    }
                  ]
                },"audit_events": {
                  Row: {
                    "action": Database["public"]['Enums']["audit_action"],"actor": NonNullable<Json>,"at": string,"entity_id": string,"entity_type": Database["public"]['Enums']["entity_type"],"id": string,"metadata": NonNullable<Json>,"seller_account_id": string | null,"seq": number,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": Database["public"]['Enums']["audit_action"],"actor": NonNullable<Json>,"at": string,"entity_id": string,"entity_type": Database["public"]['Enums']["entity_type"],"id": string,"metadata"?: NonNullable<Json>,"seller_account_id"?: string | null,"seq"?: never,"workspace_id": string
                  }
                  Update: {
                    "action"?: Database["public"]['Enums']["audit_action"],"actor"?: NonNullable<Json>,"at"?: string,"entity_id"?: string,"entity_type"?: Database["public"]['Enums']["entity_type"],"id"?: string,"metadata"?: NonNullable<Json>,"seller_account_id"?: string | null,"seq"?: never,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_events_seller_account_id_workspace_id_fkey"
      columns: ["seller_account_id","workspace_id"]
isOneToOne: false
      referencedRelation: "seller_accounts"
      referencedColumns: ["id","workspace_id"]
    },{
      foreignKeyName: "audit_events_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"campaigns": {
                  Row: {
                    "bidding_strategy": Database["public"]['Enums']["bidding_strategy"],"daily_budget": number,"end_date": string | null,"id": string,"name": string,"seller_account_id": string,"start_date": string,"state": Database["public"]['Enums']["ad_state"],"targeting_type": Database["public"]['Enums']["targeting_type"],"type": Database["public"]['Enums']["campaign_type"],"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bidding_strategy": Database["public"]['Enums']["bidding_strategy"],"daily_budget": number,"end_date"?: string | null,"id": string,"name": string,"seller_account_id": string,"start_date": string,"state": Database["public"]['Enums']["ad_state"],"targeting_type": Database["public"]['Enums']["targeting_type"],"type": Database["public"]['Enums']["campaign_type"],"workspace_id": string
                  }
                  Update: {
                    "bidding_strategy"?: Database["public"]['Enums']["bidding_strategy"],"daily_budget"?: number,"end_date"?: string | null,"id"?: string,"name"?: string,"seller_account_id"?: string,"start_date"?: string,"state"?: Database["public"]['Enums']["ad_state"],"targeting_type"?: Database["public"]['Enums']["targeting_type"],"type"?: Database["public"]['Enums']["campaign_type"],"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "campaigns_seller_account_id_workspace_id_fkey"
      columns: ["seller_account_id","workspace_id"]
isOneToOne: false
      referencedRelation: "seller_accounts"
      referencedColumns: ["id","workspace_id"]
    }
                  ]
                },"listing_versions": {
                  Row: {
                    "backend_keywords": string,"bullets": (string)[],"created_at": string,"created_by": NonNullable<Json>,"description": string,"id": string,"product_id": string,"seller_account_id": string,"status": Database["public"]['Enums']["listing_version_status"],"title": string,"version": number,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "backend_keywords": string,"bullets": (string)[],"created_at": string,"created_by": NonNullable<Json>,"description": string,"id": string,"product_id": string,"seller_account_id": string,"status": Database["public"]['Enums']["listing_version_status"],"title": string,"version": number,"workspace_id": string
                  }
                  Update: {
                    "backend_keywords"?: string,"bullets"?: (string)[],"created_at"?: string,"created_by"?: NonNullable<Json>,"description"?: string,"id"?: string,"product_id"?: string,"seller_account_id"?: string,"status"?: Database["public"]['Enums']["listing_version_status"],"title"?: string,"version"?: number,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "listing_versions_product_id_seller_account_id_workspace_id_fkey"
      columns: ["product_id","seller_account_id","workspace_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","seller_account_id","workspace_id"]
    }
                  ]
                },"members": {
                  Row: {
                    "created_at": string,"email": string,"id": string,"name": string,"role": Database["public"]['Enums']["member_role"],"seller_account_ids": (string)[],"user_id": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email": string,"id": string,"name": string,"role": Database["public"]['Enums']["member_role"],"seller_account_ids"?: (string)[],"user_id"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"email"?: string,"id"?: string,"name"?: string,"role"?: Database["public"]['Enums']["member_role"],"seller_account_ids"?: (string)[],"user_id"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "members_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"metrics_daily": {
                  Row: {
                    "ad_orders": number | null,"ad_sales": number | null,"clicks": number | null,"date": string,"entity_id": string,"entity_type": Database["public"]['Enums']["metrics_entity_type"],"impressions": number | null,"ordered_revenue": number | null,"page_views": number | null,"seller_account_id": string,"sessions": number | null,"spend": number | null,"units_ordered": number | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ad_orders"?: number | null,"ad_sales"?: number | null,"clicks"?: number | null,"date": string,"entity_id": string,"entity_type": Database["public"]['Enums']["metrics_entity_type"],"impressions"?: number | null,"ordered_revenue"?: number | null,"page_views"?: number | null,"seller_account_id": string,"sessions"?: number | null,"spend"?: number | null,"units_ordered"?: number | null,"workspace_id": string
                  }
                  Update: {
                    "ad_orders"?: number | null,"ad_sales"?: number | null,"clicks"?: number | null,"date"?: string,"entity_id"?: string,"entity_type"?: Database["public"]['Enums']["metrics_entity_type"],"impressions"?: number | null,"ordered_revenue"?: number | null,"page_views"?: number | null,"seller_account_id"?: string,"sessions"?: number | null,"spend"?: number | null,"units_ordered"?: number | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "metrics_daily_seller_account_id_workspace_id_fkey"
      columns: ["seller_account_id","workspace_id"]
isOneToOne: false
      referencedRelation: "seller_accounts"
      referencedColumns: ["id","workspace_id"]
    }
                  ]
                },"product_facts": {
                  Row: {
                    "color": string,"features": (string)[],"height_cm": number,"included_components": (string)[],"length_cm": number,"material": string,"product_id": string,"prohibited_claims": (string)[],"seller_account_id": string,"target_keywords": (string)[],"updated_at": string,"weight_grams": number,"width_cm": number,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "color": string,"features": (string)[],"height_cm": number,"included_components": (string)[],"length_cm": number,"material": string,"product_id": string,"prohibited_claims"?: (string)[],"seller_account_id": string,"target_keywords"?: (string)[],"updated_at": string,"weight_grams": number,"width_cm": number,"workspace_id": string
                  }
                  Update: {
                    "color"?: string,"features"?: (string)[],"height_cm"?: number,"included_components"?: (string)[],"length_cm"?: number,"material"?: string,"product_id"?: string,"prohibited_claims"?: (string)[],"seller_account_id"?: string,"target_keywords"?: (string)[],"updated_at"?: string,"weight_grams"?: number,"width_cm"?: number,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_facts_product_id_seller_account_id_workspace_id_fkey"
      columns: ["product_id","seller_account_id","workspace_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","seller_account_id","workspace_id"]
    }
                  ]
                },"products": {
                  Row: {
                    "asin": string,"brand": string,"category": string,"created_at": string,"id": string,"price": number,"seller_account_id": string,"sku": string,"status": Database["public"]['Enums']["product_status"],"title": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "asin": string,"brand": string,"category": string,"created_at": string,"id": string,"price": number,"seller_account_id": string,"sku": string,"status": Database["public"]['Enums']["product_status"],"title": string,"workspace_id": string
                  }
                  Update: {
                    "asin"?: string,"brand"?: string,"category"?: string,"created_at"?: string,"id"?: string,"price"?: number,"seller_account_id"?: string,"sku"?: string,"status"?: Database["public"]['Enums']["product_status"],"title"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "products_seller_account_id_workspace_id_fkey"
      columns: ["seller_account_id","workspace_id"]
isOneToOne: false
      referencedRelation: "seller_accounts"
      referencedColumns: ["id","workspace_id"]
    }
                  ]
                },"proposals": {
                  Row: {
                    "applied_at": string | null,"created_at": string,"created_by": NonNullable<Json>,"decided_at": string | null,"decided_by": Json | null,"decision_note": string | null,"diff": NonNullable<Json>,"freshness": NonNullable<Json>,"id": string,"original_diff": Json | null,"rationale": string,"review_id": string | null,"risk": Database["public"]['Enums']["proposal_risk"],"scores": NonNullable<Json>,"seller_account_id": string,"snoozed_until": string | null,"status": Database["public"]['Enums']["proposal_status"],"target_id": string,"target_type": Database["public"]['Enums']["entity_type"],"title": string,"type": Database["public"]['Enums']["proposal_type"],"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "applied_at"?: string | null,"created_at": string,"created_by": NonNullable<Json>,"decided_at"?: string | null,"decided_by"?: Json | null,"decision_note"?: string | null,"diff": NonNullable<Json>,"freshness": NonNullable<Json>,"id": string,"original_diff"?: Json | null,"rationale": string,"review_id"?: string | null,"risk": Database["public"]['Enums']["proposal_risk"],"scores": NonNullable<Json>,"seller_account_id": string,"snoozed_until"?: string | null,"status": Database["public"]['Enums']["proposal_status"],"target_id": string,"target_type": Database["public"]['Enums']["entity_type"],"title": string,"type": Database["public"]['Enums']["proposal_type"],"workspace_id": string
                  }
                  Update: {
                    "applied_at"?: string | null,"created_at"?: string,"created_by"?: NonNullable<Json>,"decided_at"?: string | null,"decided_by"?: Json | null,"decision_note"?: string | null,"diff"?: NonNullable<Json>,"freshness"?: NonNullable<Json>,"id"?: string,"original_diff"?: Json | null,"rationale"?: string,"review_id"?: string | null,"risk"?: Database["public"]['Enums']["proposal_risk"],"scores"?: NonNullable<Json>,"seller_account_id"?: string,"snoozed_until"?: string | null,"status"?: Database["public"]['Enums']["proposal_status"],"target_id"?: string,"target_type"?: Database["public"]['Enums']["entity_type"],"title"?: string,"type"?: Database["public"]['Enums']["proposal_type"],"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "proposals_review_id_fkey"
      columns: ["review_id"]
isOneToOne: false
      referencedRelation: "reviews"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "proposals_seller_account_id_workspace_id_fkey"
      columns: ["seller_account_id","workspace_id"]
isOneToOne: false
      referencedRelation: "seller_accounts"
      referencedColumns: ["id","workspace_id"]
    }
                  ]
                },"reviews": {
                  Row: {
                    "created_at": string,"id": string,"listing_version_id": string,"overall": number,"report": NonNullable<Json>,"reviewer": NonNullable<Json>,"scores": NonNullable<Json>,"seller_account_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at": string,"id": string,"listing_version_id": string,"overall": number,"report": NonNullable<Json>,"reviewer": NonNullable<Json>,"scores": NonNullable<Json>,"seller_account_id": string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"listing_version_id"?: string,"overall"?: number,"report"?: NonNullable<Json>,"reviewer"?: NonNullable<Json>,"scores"?: NonNullable<Json>,"seller_account_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reviews_listing_version_id_seller_account_id_workspace_id_fkey"
      columns: ["listing_version_id","seller_account_id","workspace_id"]
isOneToOne: false
      referencedRelation: "listing_versions"
      referencedColumns: ["id","seller_account_id","workspace_id"]
    }
                  ]
                },"seller_accounts": {
                  Row: {
                    "autonomy_level": Database["public"]['Enums']["autonomy_level"],"connected_at": string,"currency": Database["public"]['Enums']["currency"],"id": string,"marketplace": Database["public"]['Enums']["marketplace"],"name": string,"seller_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "autonomy_level": Database["public"]['Enums']["autonomy_level"],"connected_at": string,"currency": Database["public"]['Enums']["currency"],"id": string,"marketplace": Database["public"]['Enums']["marketplace"],"name": string,"seller_id": string,"workspace_id": string
                  }
                  Update: {
                    "autonomy_level"?: Database["public"]['Enums']["autonomy_level"],"connected_at"?: string,"currency"?: Database["public"]['Enums']["currency"],"id"?: string,"marketplace"?: Database["public"]['Enums']["marketplace"],"name"?: string,"seller_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "seller_accounts_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"targets": {
                  Row: {
                    "ad_group_id": string,"asin": string | null,"auto_type": Database["public"]['Enums']["auto_target_type"] | null,"bid": number | null,"id": string,"keyword": string | null,"kind": Database["public"]['Enums']["target_kind"],"match_type": Database["public"]['Enums']["match_type"] | null,"negative": boolean,"seller_account_id": string,"state": Database["public"]['Enums']["ad_state"],"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ad_group_id": string,"asin"?: string | null,"auto_type"?: Database["public"]['Enums']["auto_target_type"] | null,"bid"?: number | null,"id": string,"keyword"?: string | null,"kind": Database["public"]['Enums']["target_kind"],"match_type"?: Database["public"]['Enums']["match_type"] | null,"negative": boolean,"seller_account_id": string,"state": Database["public"]['Enums']["ad_state"],"workspace_id": string
                  }
                  Update: {
                    "ad_group_id"?: string,"asin"?: string | null,"auto_type"?: Database["public"]['Enums']["auto_target_type"] | null,"bid"?: number | null,"id"?: string,"keyword"?: string | null,"kind"?: Database["public"]['Enums']["target_kind"],"match_type"?: Database["public"]['Enums']["match_type"] | null,"negative"?: boolean,"seller_account_id"?: string,"state"?: Database["public"]['Enums']["ad_state"],"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "targets_ad_group_id_seller_account_id_workspace_id_fkey"
      columns: ["ad_group_id","seller_account_id","workspace_id"]
isOneToOne: false
      referencedRelation: "ad_groups"
      referencedColumns: ["id","seller_account_id","workspace_id"]
    }
                  ]
                },"workspaces": {
                  Row: {
                    "created_at": string,"id": string,"kind": Database["public"]['Enums']["workspace_kind"],"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id": string,"kind": Database["public"]['Enums']["workspace_kind"],"name": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["workspace_kind"],"name"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "commit_proposal_write":
{ Args: { "p_events": Json,"p_proposal": Json,"p_retire_listing_version_id"?: string }; Returns: boolean
                           },
"file_agent_run_output":
{ Args: { "p_events": Json,"p_listing_version": Json,"p_proposal": Json,"p_review": Json,"p_run": Json }; Returns: boolean
                           },
"start_agent_run":
{ Args: { "p_events": Json,"p_run": Json }; Returns: undefined
                           }
          }
          Enums: {
            "ad_state": "enabled"|"paused"|"archived","agent_name": "listing_writer"|"listing_reviewer"|"bid_optimizer"|"budget_pacer"|"keyword_harvester","agent_run_status": "queued"|"running"|"succeeded"|"failed"|"cancelled","agent_run_trigger": "schedule"|"manual"|"event","audit_action": "agent_run.started"|"agent_run.finished"|"proposal.created"|"proposal.edited"|"proposal.snoozed"|"proposal.approved"|"proposal.rejected"|"proposal.applied"|"proposal.failed"|"listing_version.published"|"member.invited"|"seller_account.connected"|"settings.updated","auto_target_type": "close_match"|"loose_match"|"substitutes"|"complements","autonomy_level": "L0"|"L1"|"L2"|"L3","bidding_strategy": "fixed"|"dynamic_down_only"|"dynamic_up_and_down","campaign_type": "sponsored_products"|"sponsored_brands"|"sponsored_display","currency": "USD"|"CAD"|"MXN"|"GBP"|"EUR"|"JPY","entity_type": "workspace"|"member"|"seller_account"|"product"|"listing_version"|"review"|"proposal"|"campaign"|"ad_group"|"target"|"agent_run","listing_version_status": "draft"|"proposed"|"live"|"superseded"|"rejected","marketplace": "US"|"CA"|"MX"|"UK"|"DE"|"FR"|"IT"|"ES"|"JP","match_type": "exact"|"phrase"|"broad","member_role": "owner"|"specialist"|"client_approver"|"viewer","metrics_entity_type": "product"|"campaign"|"target","product_status": "active"|"inactive"|"suppressed","proposal_risk": "low"|"medium"|"high","proposal_status": "pending_approval"|"approved"|"rejected"|"applied"|"failed"|"superseded","proposal_type": "listing_update"|"price_change"|"bid_change"|"budget_change"|"keyword_add"|"keyword_negate"|"target_pause","target_kind": "keyword"|"product"|"auto","targeting_type": "auto"|"manual","workspace_kind": "merchant"|"agency"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "ad_state": ["enabled", "paused", "archived"],"agent_name": ["listing_writer", "listing_reviewer", "bid_optimizer", "budget_pacer", "keyword_harvester"],"agent_run_status": ["queued", "running", "succeeded", "failed", "cancelled"],"agent_run_trigger": ["schedule", "manual", "event"],"audit_action": ["agent_run.started", "agent_run.finished", "proposal.created", "proposal.edited", "proposal.snoozed", "proposal.approved", "proposal.rejected", "proposal.applied", "proposal.failed", "listing_version.published", "member.invited", "seller_account.connected", "settings.updated"],"auto_target_type": ["close_match", "loose_match", "substitutes", "complements"],"autonomy_level": ["L0", "L1", "L2", "L3"],"bidding_strategy": ["fixed", "dynamic_down_only", "dynamic_up_and_down"],"campaign_type": ["sponsored_products", "sponsored_brands", "sponsored_display"],"currency": ["USD", "CAD", "MXN", "GBP", "EUR", "JPY"],"entity_type": ["workspace", "member", "seller_account", "product", "listing_version", "review", "proposal", "campaign", "ad_group", "target", "agent_run"],"listing_version_status": ["draft", "proposed", "live", "superseded", "rejected"],"marketplace": ["US", "CA", "MX", "UK", "DE", "FR", "IT", "ES", "JP"],"match_type": ["exact", "phrase", "broad"],"member_role": ["owner", "specialist", "client_approver", "viewer"],"metrics_entity_type": ["product", "campaign", "target"],"product_status": ["active", "inactive", "suppressed"],"proposal_risk": ["low", "medium", "high"],"proposal_status": ["pending_approval", "approved", "rejected", "applied", "failed", "superseded"],"proposal_type": ["listing_update", "price_change", "bid_change", "budget_change", "keyword_add", "keyword_negate", "target_pause"],"target_kind": ["keyword", "product", "auto"],"targeting_type": ["auto", "manual"],"workspace_kind": ["merchant", "agency"]
          }
        }
} as const
