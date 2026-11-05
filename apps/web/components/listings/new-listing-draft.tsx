import {
  LISTING_COPY_ATTRIBUTES,
  LISTING_LIMITS,
  newListingCopy,
  parseNewListing,
  utf8ByteLength,
  type Actor,
  type AttributeSource,
  type DiffEntry,
  type ProductType,
} from "@app/core";
import { AIGeneratedBadge } from "@/components/ai-generated-badge";
import { Badge } from "@/components/ui/badge";

const COPY_NAMES: ReadonlySet<string> = new Set(Object.values(LISTING_COPY_ATTRIBUTES));

const SOURCE_LABELS: Record<Exclude<AttributeSource, "agent">, string> = { facts: "From facts", seller: "From seller" };

/**
 * The listing a new_listing proposal would create: its copy, then every attribute with where its value
 * came from. Agent-drafted values carry the AIGenerated badge. Nothing here is on Amazon yet.
 */
export function NewListingDraft({ diff, productType, createdBy }: { diff: DiffEntry[]; productType?: ProductType; createdBy: Actor }) {
  const { attributes } = parseNewListing(diff);
  const copy = newListingCopy(attributes);
  const schema = new Map(productType?.attributes.map((attribute) => [attribute.name, attribute]));
  // The product type's order when it loaded, the diff's otherwise.
  const names = productType ? productType.attributes.map((attribute) => attribute.name).filter((name) => attributes.has(name)) : [...attributes.keys()];
  const rest = names.filter((name) => !COPY_NAMES.has(name));
  const badge = (name: string) =>
    attributes.get(name)?.source === "agent" ? <AIGeneratedBadge actor={createdBy} compact /> : <SourceBadge source={attributes.get(name)?.source} />;

  return (
    <div className="flex flex-col gap-4" data-testid="new-listing-draft">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
        <CopyField label="Title" meta={`${copy.title.length} characters`} badge={badge(LISTING_COPY_ATTRIBUTES.title)}>
          <p className="font-medium">{copy.title || "–"}</p>
        </CopyField>
        <CopyField label="Bullet points" meta={`${copy.bullets.length} of ${LISTING_LIMITS.bulletMaxCount}`} badge={badge(LISTING_COPY_ATTRIBUTES.bullets)}>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {copy.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        </CopyField>
        {attributes.has(LISTING_COPY_ATTRIBUTES.description) && (
          <CopyField label="Description" meta={`${copy.description.length} characters`} badge={badge(LISTING_COPY_ATTRIBUTES.description)}>
            <p className="whitespace-pre-wrap">{copy.description}</p>
          </CopyField>
        )}
        {attributes.has(LISTING_COPY_ATTRIBUTES.backendKeywords) && (
          <CopyField label="Search terms" meta={`${utf8ByteLength(copy.backendKeywords)} of ${LISTING_LIMITS.backendKeywordsMaxBytes} bytes`} badge={badge(LISTING_COPY_ATTRIBUTES.backendKeywords)}>
            <p className="font-mono text-xs">{copy.backendKeywords}</p>
          </CopyField>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Attribute</th>
              <th className="px-3 py-2 font-medium">Value</th>
              <th className="px-3 py-2 font-medium">
                <span className="sr-only">Source</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rest.map((name) => {
              const attribute = schema.get(name);
              const value = attributes.get(name)!.value;
              return (
                <tr key={name} data-testid="new-listing-attribute">
                  <td className="px-3 py-2 align-top">
                    <span className="flex flex-col">
                      <span className="font-medium">{attribute?.label ?? name}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {name}
                        {attribute?.requirement === "required" && " · required"}
                      </span>
                    </span>
                  </td>
                  <td className="max-w-md px-3 py-2 align-top break-words">
                    {Array.isArray(value) ? (
                      <ul className="flex flex-col gap-0.5">
                        {value.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      value
                    )}
                  </td>
                  <td className="px-3 py-2 text-right align-top">{badge(name)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CopyField({ label, meta, badge, children }: { label: string; meta: string; badge: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{meta}</span>
        <span className="ml-auto">{badge}</span>
      </div>
      {children}
    </div>
  );
}

function SourceBadge({ source }: { source: AttributeSource | undefined }) {
  if (!source || source === "agent") return null;
  return (
    <Badge variant="outline" className="text-muted-foreground">
      {SOURCE_LABELS[source]}
    </Badge>
  );
}
