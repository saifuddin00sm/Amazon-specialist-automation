"use client";

import {
  NEW_LISTING_LIMITS,
  NewListingBriefSchema,
  NewProductFactsSchema,
  planNewListingAttributes,
  sellerAttributes,
  sellerAttributesSchema,
  type AgentRun,
  type AttributePlan,
  type AttributeValue,
  type Marketplace,
  type NewListingBrief,
  type ProductType,
  type ProductTypeAttribute,
  type ProductTypeSummary,
} from "@app/core";
import { cn } from "cn";
import { ArrowLeft, ArrowRight, Loader2, Plus, Search, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import type { z } from "zod";
import {
  completeListingCreatorRun,
  getProductType,
  searchProductTypes,
  startListingCreator,
} from "@/app/(app)/listings/new/actions";
import { AgentRunViewer } from "@/components/agents/agent-run-viewer";
import { announceRunOutcome } from "@/components/agents/announce-run";
import { useSellerContext } from "@/components/shell/seller-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WizardSteps } from "@/components/wizard-steps";

const STEPS = ["Product facts", "Product type", "Review"] as const;

/** Each step's Zod schema: the brief, one part at a time. */
const FactsStepSchema = NewListingBriefSchema.shape.facts;
const ProductTypeStepSchema = NewListingBriefSchema.pick({ productType: true });
const MaterialSchema = NewProductFactsSchema.shape.materials.element;
const CertificationSchema = NewProductFactsSchema.shape.certifications.element;
const PhotoSchema = NewProductFactsSchema.shape.photos.element;

/** What the facts form holds while it's typed in: numbers stay text until they're checked. */
type FactsForm = {
  brand: string;
  productName: string;
  materials: string[];
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  certifications: string[];
  photos: string[];
};

const EMPTY_FACTS: FactsForm = { brand: "", productName: "", materials: [], lengthCm: "", widthCm: "", heightCm: "", certifications: [], photos: [] };

/** Radix selects can't hold an empty value; this one clears a recommended attribute. */
const LEAVE_EMPTY = "__leave_empty__";

/** The New listing wizard for the seller account picked in the top bar. */
export function NewListingWizard() {
  const { sellerAccount } = useSellerContext();
  if (!sellerAccount) {
    return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Pick a seller account to list a product in.</p>;
  }
  // Switching accounts starts over: product types belong to the account's marketplace.
  return <AccountWizard key={sellerAccount.id} sellerAccountId={sellerAccount.id} marketplace={sellerAccount.marketplace} />;
}

function AccountWizard({ sellerAccountId, marketplace }: { sellerAccountId: string; marketplace: Marketplace }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FactsForm>(EMPTY_FACTS);
  // Errors show once the member tries to move on, then follow their typing.
  const [checkFacts, setCheckFacts] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<{ results: ProductTypeSummary[] } | { error: string }>();
  const [picked, setPicked] = useState<string>();
  const [definitions, setDefinitions] = useState<Record<string, ProductType>>({});
  const [loadingType, startLoadingType] = useTransition();
  const [values, setValues] = useState<Record<string, string>>({});
  const [checkValues, setCheckValues] = useState(false);
  const [run, setRun] = useState<AgentRun>();
  const [proposalId, setProposalId] = useState<string>();
  const [submitting, startSubmit] = useTransition();

  const factsCheck = FactsStepSchema.safeParse({
    brand: form.brand,
    productName: form.productName,
    materials: form.materials,
    dimensions: { lengthCm: toNumber(form.lengthCm), widthCm: toNumber(form.widthCm), heightCm: toNumber(form.heightCm) },
    certifications: form.certifications,
    photos: form.photos,
  });
  const factErrors = checkFacts && !factsCheck.success ? fieldErrors(factsCheck.error) : {};
  const facts = factsCheck.success ? factsCheck.data : undefined;

  const productType = picked ? definitions[picked] : undefined;
  const sellerNames = useMemo(() => new Set(productType ? sellerAttributes(productType).map((attribute) => attribute.name) : []), [productType]);
  // Values typed for another product type don't carry over.
  const entered = Object.fromEntries(Object.entries(values).filter(([name, value]) => sellerNames.has(name) && value.trim() !== ""));
  const valuesSchema = useMemo(() => productType && sellerAttributesSchema(productType), [productType]);
  const valuesCheck = valuesSchema?.safeParse(entered);
  const valueErrors = checkValues && valuesCheck && !valuesCheck.success ? fieldErrors(valuesCheck.error) : {};
  const plan = productType && facts ? planNewListingAttributes(productType, facts, entered) : [];

  useEffect(() => {
    if (step !== 1) return;
    let current = true;
    const timer = window.setTimeout(() => {
      void searchProductTypes({ sellerAccountId, keywords: query }).then((result) => {
        if (current) setSearch(result.ok ? { results: result.results } : { error: result.message });
      });
    }, 200);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [step, query, sellerAccountId]);

  const update = (patch: Partial<FactsForm>) => setForm((current) => ({ ...current, ...patch }));

  const toProductType = () => {
    setCheckFacts(true);
    if (factsCheck.success) setStep(1);
  };

  const pick = (name: string) => {
    setPicked(name);
    if (definitions[name]) return;
    startLoadingType(async () => {
      const result = await getProductType({ sellerAccountId, productType: name });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setDefinitions((current) => ({ ...current, [name]: result.productType }));
    });
  };

  const toReview = () => {
    const parsed = ProductTypeStepSchema.safeParse({ productType: productType?.name });
    if (!parsed.success) {
      toast.error("Pick a product type.");
      return;
    }
    setStep(2);
  };

  const submit = () => {
    setCheckValues(true);
    if (!productType || !valuesCheck?.success) return;
    const brief = NewListingBriefSchema.safeParse({ productType: productType.name, facts, attributes: entered } satisfies Partial<NewListingBrief>);
    if (!brief.success) {
      toast.error("Some product facts aren't valid any more. Go back and check them.");
      return;
    }
    startSubmit(async () => {
      const result = await startListingCreator({ sellerAccountId, brief: brief.data });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setRun(result.run);
    });
  };

  const runId = run?.id;
  const complete = useCallback(() => {
    if (!runId) return;
    void completeListingCreatorRun({ runId }).then((result) => {
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setRun(result.run);
      setProposalId(result.proposalId);
      announceRunOutcome(result, { what: "New listing draft", open: (href) => router.push(href) });
    });
  }, [runId, router]);

  if (run) {
    const finished = run.status !== "running";
    return (
      <div className="flex flex-col gap-4">
        <AgentRunViewer key={run.id} run={run} autoPlay onPlaybackEnd={complete} />
        {finished && (
          <div className="flex flex-wrap items-center gap-2">
            {proposalId && (
              <Button asChild>
                <Link href={`/approvals?proposal=${proposalId}`}>
                  Review the draft in Approvals
                  <ArrowRight />
                </Link>
              </Button>
            )}
            <Button asChild variant="outline">
              <Link href="/listings">Back to listings</Link>
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <WizardSteps steps={STEPS} current={step} />

      {step === 0 && (
        <section className="flex flex-col gap-5" aria-labelledby="wizard-facts">
          <div className="flex flex-col gap-1">
            <h2 id="wizard-facts" className="text-lg font-semibold">
              Product facts
            </h2>
            <p className="text-sm text-muted-foreground">
              The agent writes only what these facts say, so list the certifications you can prove and nothing else.
            </p>
          </div>

          <div className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2">
            <TextField id="facts-brand" label="Brand" value={form.brand} error={factErrors.brand} onChange={(brand) => update({ brand })} />
            <TextField
              id="facts-name"
              label="Product name"
              placeholder="e.g. Insulated Water Bottle"
              value={form.productName}
              error={factErrors.productName}
              onChange={(productName) => update({ productName })}
            />
            <fieldset className="flex flex-col gap-1.5 sm:col-span-2">
              <legend className="mb-1.5 text-sm font-medium">Dimensions (cm)</legend>
              <div className="grid grid-cols-3 gap-3">
                {(
                  [
                    ["lengthCm", "Length"],
                    ["widthCm", "Width"],
                    ["heightCm", "Height"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="flex flex-col gap-1.5">
                    <Label htmlFor={`facts-${key}`} className="text-xs font-normal text-muted-foreground">
                      {label} (cm)
                    </Label>
                    <Input
                      id={`facts-${key}`}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.1"
                      className="tabular-nums"
                      value={form[key]}
                      aria-invalid={factErrors[`dimensions.${key}`] ? true : undefined}
                      onChange={(event) => update({ [key]: event.target.value })}
                    />
                    <FieldError message={factErrors[`dimensions.${key}`]} />
                  </div>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ListField
              id="facts-materials"
              label="Materials"
              hint="What it's made of, main material first."
              placeholder="e.g. 18/8 Stainless Steel"
              items={form.materials}
              max={NEW_LISTING_LIMITS.materialsMax}
              schema={MaterialSchema}
              error={factErrors.materials}
              onChange={(materials) => update({ materials })}
            />
            <ListField
              id="facts-certifications"
              label="Certifications"
              hint="Optional. Only what you hold proof of, e.g. BPA free."
              placeholder="e.g. BPA free"
              items={form.certifications}
              max={NEW_LISTING_LIMITS.certificationsMax}
              schema={CertificationSchema}
              error={factErrors.certifications}
              onChange={(certifications) => update({ certifications })}
            />
          </div>
          <ListField
            id="facts-photos"
            label="Photos"
            hint={`Links to the images, main image first: the product on a white background. Amazon recommends ${NEW_LISTING_LIMITS.photosRecommended}.`}
            placeholder="https://"
            type="url"
            items={form.photos}
            max={NEW_LISTING_LIMITS.photosMax}
            schema={PhotoSchema}
            error={factErrors.photos}
            ordered
            onChange={(photos) => update({ photos })}
          />

          <div className="flex justify-end">
            <Button onClick={toProductType}>
              Continue
              <ArrowRight />
            </Button>
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="flex flex-col gap-4" aria-labelledby="wizard-type">
          <div className="flex flex-col gap-1">
            <h2 id="wizard-type" className="text-lg font-semibold">
              Product type
            </h2>
            <p className="text-sm text-muted-foreground">
              Amazon&apos;s product type for the {marketplace} marketplace sets which attributes the listing must and should have.
            </p>
          </div>
          <div className="relative w-full max-w-sm">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search product types, e.g. water bottle"
              aria-label="Search product types"
              className="pl-8"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(240px,320px)_1fr]">
            <fieldset className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto" aria-busy={search === undefined}>
              <legend className="sr-only">Product types</legend>
              {search === undefined ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Searching
                </p>
              ) : "error" in search ? (
                <p className="text-sm text-destructive" role="alert">
                  {search.error}
                </p>
              ) : search.results.length === 0 ? (
                <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No product types match. Try a broader word.</p>
              ) : (
                search.results.map((result) => (
                  <label
                    key={result.name}
                    className={cn(
                      "flex cursor-pointer flex-col gap-0.5 rounded-xl border bg-card px-3 py-2.5 text-sm has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                      picked === result.name && "border-primary bg-primary/5",
                    )}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <input
                        type="radio"
                        name="product-type"
                        value={result.name}
                        checked={picked === result.name}
                        onChange={() => pick(result.name)}
                        className="accent-primary"
                      />
                      {result.displayName}
                      <span className="font-mono text-xs font-normal text-muted-foreground">{result.name}</span>
                    </span>
                    <span className="pl-5 text-muted-foreground">{result.description}</span>
                  </label>
                ))
              )}
            </fieldset>

            <div className="min-w-0" aria-live="polite">
              {productType ? (
                <ProductTypeAttributes productType={productType} />
              ) : (
                <div className="flex h-full min-h-48 items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground">
                  {picked && loadingType ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                      Loading attributes
                    </>
                  ) : (
                    "Pick a product type to see its attributes."
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep(0)}>
              <ArrowLeft />
              Back
            </Button>
            <Button onClick={toReview} disabled={!productType}>
              Continue
              <ArrowRight />
            </Button>
          </div>
        </section>
      )}

      {step === 2 && productType && facts && (
        <section className="flex flex-col gap-4" aria-labelledby="wizard-review">
          <div className="flex flex-col gap-1">
            <h2 id="wizard-review" className="text-lg font-semibold">
              Review
            </h2>
            <p className="text-sm text-muted-foreground">
              What your facts fill, what only you can fill, and what the listing creator will draft as a {productType.displayName.toLowerCase()}. You approve
              or reject the draft in Approvals; nothing is listed until then.
            </p>
          </div>
          <dl className="flex flex-wrap gap-x-8 gap-y-2 rounded-xl border bg-card px-4 py-3 text-sm">
            <Stat label="Product type">{productType.displayName}</Stat>
            <Stat label="From your facts">{count(plan, ["facts"])}</Stat>
            <Stat label="From you">{count(plan, ["seller"])}</Stat>
            <Stat label="Agent drafts">{count(plan, ["agent"])}</Stat>
            <Stat label="Still needed">{count(plan, ["missing"])}</Stat>
          </dl>

          <AttributeGroup id="you" title="You fill in" description="Only you know these. Required ones must be filled in to draft the listing.">
            {plan
              .filter(({ attribute }) => sellerNames.has(attribute.name))
              .map(({ attribute }) => (
                <SellerAttributeField
                  key={attribute.name}
                  attribute={attribute}
                  value={values[attribute.name] ?? ""}
                  error={valueErrors[attribute.name]}
                  onChange={(value) => setValues((current) => ({ ...current, [attribute.name]: value }))}
                />
              ))}
          </AttributeGroup>

          <AttributeGroup id="facts" title="Filled from your facts">
            {plan
              .filter(({ status }) => status === "facts")
              .map(({ attribute, value }) => (
                <AttributeRow key={attribute.name} attribute={attribute}>
                  <AttributeValueText value={value} />
                </AttributeRow>
              ))}
          </AttributeGroup>

          <AttributeGroup id="agent" title="The agent drafts" description="Written from the facts above and your values, then checked against Amazon's limits.">
            {plan
              .filter(({ status }) => status === "agent")
              .map(({ attribute }) => (
                <AttributeRow key={attribute.name} attribute={attribute}>
                  <span className="inline-flex items-center gap-1 text-violet-700 dark:text-violet-300">
                    <Sparkles className="size-3.5" aria-hidden />
                    Agent drafts
                  </span>
                </AttributeRow>
              ))}
          </AttributeGroup>

          <AttributeGroup id="empty" title="Left empty" description="Recommended, but no fact fills them. Add them in Product facts to include them.">
            {plan
              .filter(({ attribute, status }) => !sellerNames.has(attribute.name) && (status === "empty" || status === "missing"))
              .map(({ attribute }) => (
                <AttributeRow key={attribute.name} attribute={attribute}>
                  <span className="text-muted-foreground">Left empty</span>
                </AttributeRow>
              ))}
          </AttributeGroup>

          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep(1)} disabled={submitting}>
              <ArrowLeft />
              Back
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? <Loader2 className="animate-spin" /> : <Sparkles />}
              Draft listing
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

/** Step 2: the picked product type's schema, required first. */
function ProductTypeAttributes({ productType }: { productType: ProductType }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4" data-testid="product-type-attributes">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-semibold">{productType.displayName} attributes</h3>
        <p className="text-xs text-muted-foreground">From Amazon&apos;s schema for {productType.name}.</p>
      </div>
      {(["required", "recommended"] as const).map((requirement) => {
        const attributes = productType.attributes.filter((attribute) => attribute.requirement === requirement);
        return (
          <div key={requirement} className="flex flex-col gap-1.5">
            <h4 className="text-xs font-medium text-muted-foreground capitalize">
              {requirement} <span className="tabular-nums">({attributes.length})</span>
            </h4>
            <ul className="divide-y rounded-lg border" aria-label={`${requirement} attributes`}>
              {attributes.map((attribute) => (
                <li key={attribute.name} className="flex flex-col px-3 py-2 text-sm">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{attribute.label}</span>
                    <span className="font-mono text-xs text-muted-foreground">{attribute.name}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{attribute.description}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function AttributeGroup({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode[] }) {
  if (children.length === 0) return null;
  return (
    <section className="flex flex-col gap-2 rounded-xl border bg-card p-4" aria-labelledby={`group-${id}`} data-testid={`attribute-group-${id}`}>
      <div className="flex flex-col gap-0.5">
        <h3 id={`group-${id}`} className="text-sm font-semibold">
          {title} <span className="font-normal text-muted-foreground tabular-nums">({children.length})</span>
        </h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <ul className="flex flex-col divide-y">{children}</ul>
    </section>
  );
}

function AttributeRow({ attribute, children }: { attribute: ProductTypeAttribute; children: React.ReactNode }) {
  return (
    <li className="grid gap-1 py-2 text-sm sm:grid-cols-[minmax(0,14rem)_1fr] sm:gap-4">
      <AttributeName attribute={attribute} />
      <div className="min-w-0 break-words">{children}</div>
    </li>
  );
}

function AttributeName({ attribute, htmlFor }: { attribute: ProductTypeAttribute; htmlFor?: string }) {
  const Name = htmlFor ? "label" : "span";
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Name htmlFor={htmlFor} className="font-medium">
        {attribute.label}
      </Name>
      <RequirementBadge requirement={attribute.requirement} />
    </span>
  );
}

function SellerAttributeField({
  attribute,
  value,
  error,
  onChange,
}: {
  attribute: ProductTypeAttribute;
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
}) {
  const id = `attribute-${attribute.name}`;
  return (
    <li className="grid gap-1 py-2 text-sm sm:grid-cols-[minmax(0,14rem)_1fr] sm:gap-4">
      <span className="flex flex-col gap-0.5">
        <AttributeName attribute={attribute} htmlFor={id} />
        <span className="text-xs text-muted-foreground">{attribute.description}</span>
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        {attribute.options ? (
          <Select value={value || undefined} onValueChange={(next) => onChange(next === LEAVE_EMPTY ? "" : next)}>
            <SelectTrigger id={id} className="w-full" aria-invalid={error ? true : undefined}>
              <SelectValue placeholder={`Pick a ${attribute.label.toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent>
              {attribute.requirement === "recommended" && <SelectItem value={LEAVE_EMPTY}>Leave empty</SelectItem>}
              {attribute.options.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input id={id} value={value} aria-invalid={error ? true : undefined} onChange={(event) => onChange(event.target.value)} />
        )}
        <FieldError message={error} />
      </div>
    </li>
  );
}

function RequirementBadge({ requirement }: { requirement: ProductTypeAttribute["requirement"] }) {
  return requirement === "required" ? (
    <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">
      Required
    </Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      Recommended
    </Badge>
  );
}

function AttributeValueText({ value }: { value: AttributeValue | undefined }) {
  if (Array.isArray(value)) {
    return (
      <ul className="flex flex-col gap-0.5">
        {value.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }
  return <span>{value}</span>;
}

function TextField({
  id,
  label,
  value,
  placeholder,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  error: string | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} placeholder={placeholder} aria-invalid={error ? true : undefined} onChange={(event) => onChange(event.target.value)} />
      <FieldError message={error} />
    </div>
  );
}

/** A list of short values, added one at a time and each checked with `schema` before it's added. */
function ListField({
  id,
  label,
  hint,
  placeholder,
  type = "text",
  items,
  max,
  schema,
  error,
  ordered,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  placeholder: string;
  type?: "text" | "url";
  items: string[];
  max: number;
  schema: z.ZodType<string>;
  error: string | undefined;
  /** The first item is the main one (photos). */
  ordered?: boolean;
  onChange: (items: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string>();
  const full = items.length >= max;

  const add = () => {
    const parsed = schema.safeParse(draft.trim());
    if (!parsed.success) {
      setDraftError(parsed.error.issues[0]?.message);
      return;
    }
    if (!items.some((item) => item.toLowerCase() === parsed.data.toLowerCase())) onChange([...items, parsed.data]);
    setDraft("");
    setDraftError(undefined);
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-4" role="group" aria-labelledby={`${id}-label`}>
      <div className="flex flex-col gap-0.5">
        <Label id={`${id}-label`} htmlFor={id}>
          {label}
          <span className="font-normal text-muted-foreground tabular-nums">
            {items.length}/{max}
          </span>
        </Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="flex gap-2">
        <Input
          id={id}
          type={type}
          value={draft}
          placeholder={placeholder}
          disabled={full}
          aria-invalid={draftError || error ? true : undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            setDraftError(undefined);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            add();
          }}
        />
        <Button type="button" variant="outline" onClick={add} disabled={full || draft.trim() === ""} aria-label={`Add to ${label.toLowerCase()}`}>
          <Plus />
          Add
        </Button>
      </div>
      <FieldError message={draftError ?? error} />
      {items.length > 0 && (
        <ul className={cn("flex gap-1.5", ordered ? "flex-col" : "flex-wrap")} aria-label={label}>
          {items.map((item, i) => (
            <li key={item} className={cn("flex min-w-0 items-center gap-1.5 rounded-md border bg-muted/40 py-0.5 pr-0.5 pl-2 text-sm", ordered && "justify-between")}>
              <span className="flex min-w-0 items-center gap-2">
                {ordered && (
                  <Badge variant={i === 0 ? "default" : "outline"} className="shrink-0">
                    {i === 0 ? "Main" : i + 1}
                  </Badge>
                )}
                <span className="truncate">{item}</span>
              </span>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label={`Remove ${item}`}
                onClick={() => onChange(items.filter((candidate) => candidate !== item))}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FieldError({ message }: { message: string | undefined }) {
  return message ? (
    <p className="text-xs text-destructive" role="alert">
      {message}
    </p>
  ) : null;
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{children}</dd>
    </div>
  );
}

function count(plan: AttributePlan[], statuses: AttributePlan["status"][]): number {
  return plan.filter(({ status }) => statuses.includes(status)).length;
}

/** Empty text is no number, so the schema asks for one. */
function toNumber(value: string): number {
  return value.trim() === "" ? Number.NaN : Number(value);
}

/** The first message per field: "brand", "dimensions.lengthCm", "photos" (for any photo). */
function fieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const [first, second] = issue.path;
    const key = first === "dimensions" && typeof second === "string" ? `dimensions.${second}` : String(first ?? "");
    errors[key] ??= issue.message;
  }
  return errors;
}
