import type { Marketplace } from "@app/core";

/** The SP-API regions; each serves the marketplaces listed in MARKETPLACE_REGIONS. */
export type SpApiRegion = "na" | "eu" | "fe";

/** Sandbox answers with Amazon's canned responses and changes nothing. */
export type AmazonEnvironment = "sandbox" | "production";

export const MARKETPLACE_IDS: Record<Marketplace, string> = {
  US: "ATVPDKIKX0DER",
  CA: "A2EUQ1WTGCTBG2",
  MX: "A1AM78C64UM0Y8",
  UK: "A1F83G8C2ARO7P",
  DE: "A1PA6795UKMFR9",
  FR: "A13V1IB3VIYZZH",
  IT: "APJ6JRA9NG5V4",
  ES: "A1RKKUPIHCS9HS",
  JP: "A1VC38T7YXB528",
};

export const MARKETPLACE_REGIONS: Record<Marketplace, SpApiRegion> = {
  US: "na",
  CA: "na",
  MX: "na",
  UK: "eu",
  DE: "eu",
  FR: "eu",
  IT: "eu",
  ES: "eu",
  JP: "fe",
};

/** The language each marketplace's listing copy is written in, as Amazon tags attribute values. */
export const MARKETPLACE_LANGUAGES: Record<Marketplace, string> = {
  US: "en_US",
  CA: "en_CA",
  MX: "es_MX",
  UK: "en_GB",
  DE: "de_DE",
  FR: "fr_FR",
  IT: "it_IT",
  ES: "es_ES",
  JP: "ja_JP",
};

const HOSTS: Record<SpApiRegion, string> = {
  na: "sellingpartnerapi-na.amazon.com",
  eu: "sellingpartnerapi-eu.amazon.com",
  fe: "sellingpartnerapi-fe.amazon.com",
};

/** Login with Amazon's token endpoint, the same for every region. */
export const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";

export function spApiEndpoint(region: SpApiRegion, environment: AmazonEnvironment): string {
  return `https://${environment === "sandbox" ? "sandbox." : ""}${HOSTS[region]}`;
}

/** The sandbox unless AMAZON_ENV=production is set. */
export function amazonEnvironment(env: NodeJS.ProcessEnv = process.env): AmazonEnvironment {
  return env.AMAZON_ENV === "production" ? "production" : "sandbox";
}
