import { z } from "zod";
import { AutonomyLevelSchema } from "./autonomy";
import { CurrencySchema, IdSchema, IsoDateTimeSchema, MarketplaceSchema } from "./common";

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
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

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

/** An Amazon Seller Central account connected to a workspace. */
export const SellerAccountSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  name: z.string().min(1),
  /** Amazon merchant token. */
  sellerId: z.string().regex(/^A[0-9A-Z]{12,13}$/),
  marketplace: MarketplaceSchema,
  currency: CurrencySchema,
  autonomyLevel: AutonomyLevelSchema,
  /** Advertising cost of sales the account aims for, as a fraction (0.3 = 30%). */
  targetAcos: z.number().positive().max(1),
  connectedAt: IsoDateTimeSchema,
});
export type SellerAccount = z.infer<typeof SellerAccountSchema>;
