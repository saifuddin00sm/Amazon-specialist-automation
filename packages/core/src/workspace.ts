import { z } from "zod";
import { AutonomyLevelSchema, type AutonomyLevel } from "./autonomy";
import { CurrencySchema, IdSchema, IsoDateTimeSchema, MarketplaceSchema, type Currency, type Marketplace } from "./common";
import { ProposalTypeSchema, type ProposalType } from "./proposal";

/** A merchant runs its own seller accounts; an agency runs its clients' accounts. */
export const WorkspaceKindSchema = z.enum(["merchant", "agency"]);
export type WorkspaceKind = z.infer<typeof WorkspaceKindSchema>;

/** A color as #rrggbb. */
export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a color like #1f6feb");

/** Longest logo, in characters: a data URL of an image up to about 100 KB, or an https URL. */
export const LOGO_MAX_LENGTH = 150_000;

/** A logo as an image data URL (stored with the workspace, so reports print without fetching) or an https URL. */
export const LogoSchema = z
  .string()
  .max(LOGO_MAX_LENGTH, "Use an image under 100 KB")
  .regex(/^(data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/]+=*|https:\/\/\S+)$/, "Use a PNG, JPEG, WebP or SVG image");

/** How reports look when they leave the app: the agency's or merchant's name, logo and colors. */
export const BrandingSchema = z.object({
  /** Name in the report header. Defaults to the workspace name. */
  displayName: z.string().trim().min(1).max(80).optional(),
  logo: LogoSchema.optional(),
  /** Header background. */
  primaryColor: HexColorSchema,
  /** Rules and highlights. */
  accentColor: HexColorSchema,
});
export type Branding = z.infer<typeof BrandingSchema>;

/** What reports use when a workspace hasn't set its own branding. */
export const DEFAULT_BRANDING: Branding = { primaryColor: "#18181b", accentColor: "#2a78d6" };

export const WorkspaceSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  kind: WorkspaceKindSchema,
  createdAt: IsoDateTimeSchema,
  /** White-label branding for reports. */
  branding: BrandingSchema.optional(),
  /** Kill switch: while set, no agent starts, files or auto-approves anything in the workspace. */
  agentsPausedAt: IsoDateTimeSchema.optional(),
  /** The member who paused agents. */
  agentsPausedBy: IdSchema.optional(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export function agentsPaused(workspace: Pick<Workspace, "agentsPausedAt">): boolean {
  return workspace.agentsPausedAt !== undefined;
}

/** Near-black or white, whichever reads better on `background` (WCAG contrast). */
export function readableTextColor(background: string): "#0b0b0b" | "#ffffff" {
  const luminance = relativeLuminance(background);
  const onDark = 1.05 / (luminance + 0.05);
  const onLight = (luminance + 0.05) / (relativeLuminance("#0b0b0b") + 0.05);
  return onLight >= onDark ? "#0b0b0b" : "#ffffff";
}

function relativeLuminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export const MemberRoleSchema = z.enum(["owner", "specialist", "client_approver", "viewer"]);
export type MemberRole = z.infer<typeof MemberRoleSchema>;

export const MemberSchema = z
  .object({
    id: IdSchema,
    workspaceId: IdSchema,
    name: z.string().min(1),
    email: z.email(),
    role: MemberRoleSchema,
    /** Accounts this member is limited to. Empty means every account in the workspace. */
    sellerAccountIds: z.array(IdSchema),
    createdAt: IsoDateTimeSchema,
  })
  .refine((member) => member.role !== "client_approver" || member.sellerAccountIds.length > 0, {
    message: "A client_approver must be scoped to at least one seller account",
    path: ["sellerAccountIds"],
  });
export type Member = z.infer<typeof MemberSchema>;

/**
 * Caps on bids and budgets for one seller account, in its currency. A bid or budget above its cap
 * blocks approval; a step above the step limit is a warning (and stops L2 auto-approval).
 * Steps are fractions: 0.5 = ±50% in one change.
 */
export const GuardrailsSchema = z.object({
  maxBid: z.number().min(0.02, "The bid cap must be at least 0.02").max(1000),
  maxBidStep: z.number().min(0.01, "Allow at least a 1% bid step").max(10),
  maxDailyBudget: z.number().min(1, "The budget cap must be at least 1").max(1_000_000),
  maxBudgetStep: z.number().min(0.01, "Allow at least a 1% budget step").max(10),
});
export type Guardrails = z.infer<typeof GuardrailsSchema>;

/** What an account uses until an owner sets its own guardrails. */
export const DEFAULT_GUARDRAILS: Guardrails = { maxBid: 50, maxBidStep: 0.5, maxDailyBudget: 10_000, maxBudgetStep: 1 };

/** Autonomy for some action types, overriding the account's level for those. */
export const AutonomyByActionSchema = z.partialRecord(ProposalTypeSchema, AutonomyLevelSchema);
export type AutonomyByAction = z.infer<typeof AutonomyByActionSchema>;

/** Currency each marketplace sells in. */
export const MARKETPLACE_CURRENCY: Record<Marketplace, Currency> = {
  US: "USD",
  CA: "CAD",
  MX: "MXN",
  UK: "GBP",
  DE: "EUR",
  FR: "EUR",
  IT: "EUR",
  ES: "EUR",
  JP: "JPY",
};

/** An Amazon Seller Central account connected to a workspace. */
export const SellerAccountSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  name: z.string().min(1),
  /** Amazon merchant token. */
  sellerId: z.string().regex(/^A[0-9A-Z]{12,13}$/),
  marketplace: MarketplaceSchema,
  currency: CurrencySchema,
  /** Default autonomy for every action type without its own level. */
  autonomyLevel: AutonomyLevelSchema,
  autonomyByAction: AutonomyByActionSchema.optional(),
  guardrails: GuardrailsSchema.optional(),
  /** Advertising cost of sales the account aims for, as a fraction (0.3 = 30%). */
  targetAcos: z.number().positive().max(1),
  connectedAt: IsoDateTimeSchema,
});
export type SellerAccount = z.infer<typeof SellerAccountSchema>;

export function guardrailsFor(account: Pick<SellerAccount, "guardrails">): Guardrails {
  return account.guardrails ?? DEFAULT_GUARDRAILS;
}

/** How far agents may go on one action type in this account. */
export function autonomyFor(account: Pick<SellerAccount, "autonomyLevel" | "autonomyByAction">, type: ProposalType): AutonomyLevel {
  return account.autonomyByAction?.[type] ?? account.autonomyLevel;
}
