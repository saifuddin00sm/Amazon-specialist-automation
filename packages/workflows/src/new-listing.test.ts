import {
  MARKETPLACE_IDS,
  SANDBOX_PRODUCT_TYPE_SCHEMAS,
  USER_AGENT,
  createAccessTokenProvider,
  createMemoryRefreshTokenStore,
  createRefreshTokenVault,
  createSpApiClient,
  generateEncryptionKey,
  loadProductTypeSchema,
  parseEncryptionKey,
  productTypeFromSchema,
} from "@app/amazon";
import { fakeAmazon, fakeClock, json, sandboxExamples, type RecordedRequest } from "@app/amazon/testing";
import { NewListingBriefSchema, sellerAttributesSchema, type AgentRun, type ListingCopy, type NewListingBrief } from "@app/core";
import { createMockDataSource, generateMockDataset, type AmazonAuthorizationStore } from "@app/data";
import type { CompletionRequest, LlmProvider, PromptOutput, PROMPTS } from "@app/llm";
import { validateAttributes } from "@app/rules";
import { describe, expect, it } from "vitest";
import type { RunStep } from "./catalog-sync";
import type { NewListingDeps } from "./deps";
import { NOT_SUBMITTED, approvedListingsToSubmit, draftNewListing, failNewListingSubmission, submitNewListing, trackNewListing, type SendEvent } from "./new-listing";

const dataset = generateMockDataset();
const merchant = dataset.workspaces[0]!;
const owner = dataset.members.find((member) => member.workspaceId === merchant.id && member.role === "owner")!;
const viewer = dataset.members.find((member) => member.workspaceId === merchant.id && member.role === "viewer")!;
const sellerId = "A2TESTSELLER01";
const US = MARKETPLACE_IDS.US;
const luggageSchema = SANDBOX_PRODUCT_TYPE_SCHEMAS.LUGGAGE!;

/** What the seller types into the New listing wizard for a carry-on suitcase. */
const FACTS = {
  brand: "Trailcraft",
  productName: "Hardside Carry-On Spinner",
  materials: ["Polycarbonate", "Aluminum"],
  dimensions: { lengthCm: 55, widthCm: 35, heightCm: 23 },
  certifications: [],
  photos: ["https://images.example.com/carry-on-main.jpg", "https://images.example.com/carry-on-side.jpg"],
};
const SELLER_VALUES = { supplier_declared_has_product_identifier_exemption: "Yes", country_of_origin: "Vietnam", color: "Graphite" };

/** A first draft that says only what the facts say, and cites them. */
function groundedDraft(): PromptOutput<typeof PROMPTS.listingCreate> {
  const listing: ListingCopy = {
    title: "Trailcraft Hardside Carry-On Spinner – Polycarbonate and Aluminum, Graphite",
    bullets: ["TOUGH SHELL – Made from polycarbonate and aluminum.", "CABIN SIZE – Measures 55 × 35 × 23 cm.", "GRAPHITE FINISH – Comes in graphite."],
    description: "The Trailcraft Hardside Carry-On Spinner is made from polycarbonate and aluminum and measures 55 × 35 × 23 cm.",
    backendKeywords: "suitcase luggage travel rolling cabin",
  };
  return {
    listing,
    changes: (["title", "bullets.0", "bullets.1", "bullets.2", "description", "backendKeywords"] as const).map((path) => ({ path, reason: "Written from the facts." })),
    claims: [
      { path: "title", text: "Polycarbonate and Aluminum", facts: ["materials.0", "materials.1"] },
      { path: "bullets.0", text: "polycarbonate and aluminum", facts: ["materials.0", "materials.1"] },
      { path: "bullets.1", text: "55 × 35 × 23 cm", facts: ["dimensions"] },
      { path: "bullets.2", text: "graphite", facts: ["attributes.color"] },
      { path: "description", text: "measures 55 × 35 × 23 cm", facts: ["dimensions"] },
    ],
    attributes: [{ name: "item_type_keyword", value: "Carry-On Luggage", facts: ["productName"] }],
    missingFacts: [],
  };
}

const goodReview: PromptOutput<typeof PROMPTS.listingReview> = {
  scores: { title: 5, bullets: 4, description: 4, keywords: 4, factual_accuracy: 5, compliance: 5 },
  summary: "Accurate to the facts and within Amazon's limits.",
  findings: [],
};

/** A provider that answers the writer with `draft` and the reviewer with `review`, each given its round. */
function scriptedModel({
  draft = () => groundedDraft(),
  review = () => goodReview,
}: { draft?: (round: number) => PromptOutput<typeof PROMPTS.listingCreate>; review?: (round: number) => PromptOutput<typeof PROMPTS.listingReview> } = {}) {
  const requests: CompletionRequest[] = [];
  const provider: LlmProvider = {
    name: "anthropic",
    dataPolicy: { trainsOnInputs: false, basis: "test" },
    complete: async (request) => {
      requests.push(request);
      const writes = request.system.startsWith("You write the first Amazon listing");
      const round = requests.filter((candidate) => candidate.system === request.system).length;
      return {
        model: request.model,
        text: JSON.stringify(writes ? draft(round) : review(round)),
        stopReason: "end",
        usage: { inputTokens: 1800, outputTokens: 700, cacheReadTokens: 0, cacheWriteTokens: 0 },
      };
    },
  };
  return { provider, requests };
}

function memoryAuthorizations(): AmazonAuthorizationStore {
  const sealed = new Map<string, string>();
  return { get: async (id) => sealed.get(id), set: async (id, value) => void sealed.set(id, value), sellerIds: async () => [...sealed.keys()] };
}

const isNewListingRead = (request: RecordedRequest) => request.method === "GET" && request.url.pathname.includes("/items/") && request.url.pathname.includes("/NL-");

/** The listing as Amazon holds it once it is processed: in the catalog, nothing in error. */
function liveListing(request: RecordedRequest): Response {
  const sku = decodeURIComponent(request.url.pathname.split("/").at(-1)!);
  return json(200, {
    sku,
    summaries: [
      {
        marketplaceId: US,
        asin: "B0TRAILCR1",
        productType: "LUGGAGE",
        status: ["DISCOVERABLE"],
        itemName: groundedDraft().listing.title,
        createdDate: "2026-11-23T10:05:00Z",
        lastUpdatedDate: "2026-11-23T11:00:00Z",
      },
    ],
    issues: [],
  });
}

async function setup({
  amazon: handler = sandboxExamples,
  model = scriptedModel(),
  connected = true,
  autonomy,
}: { amazon?: (request: RecordedRequest) => Response; model?: ReturnType<typeof scriptedModel>; connected?: boolean; autonomy?: "L3" } = {}) {
  const { clock } = fakeClock(Date.parse("2026-11-23T10:00:00.000Z"));
  const dataSource = createMockDataSource(dataset, { now: () => new Date(clock.now()) });
  const account = await dataSource.connectSellerAccount({ workspaceId: merchant.id, memberId: owner.id, name: "Trailcraft US", marketplace: "US", sellerId });
  if (autonomy) await dataSource.updateSellerAccountSettings({ sellerAccountId: account.id, memberId: owner.id, autonomyLevel: autonomy });
  const authorizations = memoryAuthorizations();
  if (connected) await authorizations.set(sellerId, "v1.sealed");

  // The real SP-API client, against Amazon's sandbox answers.
  const amazon = fakeAmazon(handler);
  const vault = createRefreshTokenVault(createMemoryRefreshTokenStore(), parseEncryptionKey(generateEncryptionKey()));
  await vault.save(sellerId, "Atzr|refresh-1");
  const accessTokens = createAccessTokenProvider(vault, { clientId: "client", clientSecret: "secret" }, { fetch: amazon.fetch, logger: () => {}, clock });
  const client = createSpApiClient({ region: "na", environment: "sandbox", accessTokens, fetch: amazon.fetch, logger: () => {}, clock, random: () => 1 });

  const deps: NewListingDeps = {
    dataSource,
    authorizations,
    amazon: () => client,
    productTypeSchema: (definition) => loadProductTypeSchema(definition, { environment: "sandbox" }),
    llm: () => model.provider,
    now: () => new Date(clock.now()),
  };

  // Like Inngest: each step's result is kept as JSON and handed back from it. `retry` runs a step's
  // work twice, as Inngest does when a step fails after doing some of it.
  const steps: string[] = [];
  const retry = new Set<string>();
  const run: RunStep = async (name, fn) => {
    steps.push(name);
    if (retry.has(name)) await fn();
    return JSON.parse(JSON.stringify(await fn()));
  };
  const sent: { name: string; events: unknown[] }[] = [];
  const sendEvent: SendEvent = async (name, events) => void sent.push({ name, events });

  /** The brief the wizard builds: the product type Amazon describes, and the seller's values as its last step checks them. */
  const wizardBrief = async (values: Record<string, string> = SELLER_VALUES, overrides: Partial<NewListingBrief> = {}): Promise<NewListingBrief> => {
    const [found] = (await client.searchDefinitionsProductTypes({ sellerId, marketplaceIds: [US], itemName: "Hardside Carry-On Spinner" })).productTypes;
    const definition = await client.getDefinitionsProductType({ sellerId, productType: found!.name, marketplaceIds: [US] });
    const productType = productTypeFromSchema(definition, await loadProductTypeSchema(definition, { environment: "sandbox" }));
    const attributes = sellerAttributesSchema(productType).parse(values) as Record<string, string>;
    amazon.requests.length = 0;
    return NewListingBriefSchema.parse({ productType: productType.name, facts: FACTS, attributes, ...overrides });
  };
  const draft = async (brief: NewListingBrief, memberId = owner.id) =>
    draftNewListing(deps, { requestId: "01JNEWLISTING", sellerAccountId: account.id, memberId, brief }, { run, sendEvent });
  /** Drafts and files the listing, then has the owner approve it. */
  const approved = async () => {
    const filed = await draft(await wizardBrief());
    if (filed.outcome !== "filed") throw new Error(filed.outcome);
    await dataSource.approveProposal({ proposalId: filed.proposalId, memberId: owner.id });
    return filed;
  };
  const runOf = async (runId: string) => (await dataSource.getAgentRun(runId)) as AgentRun;
  return { dataSource, account, deps, amazon, model, steps, retry, run, sent, wizardBrief, draft, approved, runOf };
}

const puts = (requests: RecordedRequest[]) => requests.filter((request) => request.method === "PUT");

describe("new listings", () => {
  it("take a product from the wizard to a sandbox submission with no schema errors, then follow it until it is live", async () => {
    const amazonAnswers = (request: RecordedRequest) => (isNewListingRead(request) ? liveListing(request) : sandboxExamples(request));
    const { deps, amazon, dataSource, steps, run, wizardBrief, draft, runOf } = await setup({ amazon: amazonAnswers });

    const filed = await draft(await wizardBrief());
    expect(filed).toMatchObject({ outcome: "filed", runId: "run_nl_01JNEWLISTING", status: "pending_approval" });
    if (filed.outcome !== "filed") throw new Error(filed.outcome);
    const approved = await dataSource.approveProposal({ proposalId: filed.proposalId, memberId: owner.id });
    // The approval's event starts the submission.
    const submitted = await submitNewListing(deps, approved.id, run);
    expect(submitted).toMatchObject({ outcome: "submitted", submission: { status: "accepted", issues: [] } });
    if (submitted.outcome !== "submitted") throw new Error(submitted.outcome);
    const { sku } = submitted.submission;
    // So does each of Amazon's notifications about it.
    const tracked = await trackNewListing(deps, { notificationType: "LISTINGS_ITEM_STATUS_CHANGE", sellerId, marketplaceId: US, sku }, run);
    expect(tracked).toMatchObject({ outcome: "tracked", submission: { status: "live", asin: "B0TRAILCR1" } });

    // Amazon validated it, then took it once approved: the same listing, as a whole put, with no issues.
    const [preview, submit] = puts(amazon.spApiRequests());
    expect(preview!.url.searchParams.get("mode")).toBe("VALIDATION_PREVIEW");
    expect(submit!.url.searchParams.get("mode")).toBeNull();
    expect(submit!.url.pathname).toBe(`/listings/2021-08-01/items/${sellerId}/${sku}`);
    expect(submit!.url.searchParams.get("marketplaceIds")).toBe(US);
    const body = JSON.parse(submit!.body!);
    expect(JSON.parse(preview!.body!)).toEqual(body);
    expect(body).toMatchObject({ productType: "LUGGAGE", requirements: "LISTING_PRODUCT_ONLY" });
    expect(validateAttributes(body.attributes, luggageSchema)).toEqual([]);
    expect(Object.keys(body.attributes).sort()).toEqual(
      [
        "brand",
        "bullet_point",
        "color",
        "country_of_origin",
        "generic_keyword",
        "item_dimensions",
        "item_name",
        "item_type_keyword",
        "main_product_image_locator",
        "material",
        "product_description",
        "supplier_declared_has_product_identifier_exemption",
      ].sort(),
    );
    expect(body.attributes.country_of_origin).toEqual([{ value: "VN", marketplace_id: US }]);
    for (const sent of amazon.requests) expect(sent.headers.get("user-agent")).toBe(USER_AGENT);

    // The proposal was approved, then published with Amazon's answer, then followed until live.
    const proposal = await dataSource.getProposal(filed.proposalId);
    expect(proposal).toMatchObject({
      type: "new_listing",
      status: "applied",
      title: "New listing: Trailcraft Hardside Carry-On Spinner",
      listingSubmission: { sku, status: "live", asin: "B0TRAILCR1", issues: [], submissionId: "f1dc2914-75dd-11ea-bc55-0242ac130003" },
    });
    const events = await dataSource.listAuditEvents({ workspaceId: merchant.id, limit: 3 });
    expect(events.map((event) => event.action)).toEqual(["proposal.listing_updated", "proposal.applied", "proposal.approved"]);

    // Every stage was a named step.
    expect(steps).toEqual([
      "start",
      "check listing restrictions",
      "load the product type schema",
      "draft round 1",
      "check round 1",
      "review round 1",
      "record review round 1",
      "validate on Amazon",
      "file for approval",
      "read the proposal",
      "submit to Amazon",
      "update the listing",
    ]);

    // The run shows its work, and every model call it made, each with its step.
    const draftRun = await runOf(filed.runId);
    expect(draftRun).toMatchObject({ status: "succeeded", proposalIds: [filed.proposalId] });
    expect(draftRun.steps!.map((step) => [step.kind, step.title])).toEqual([
      ["plan", "Listing restrictions"],
      ["plan", "Read the product type schema"],
      ["draft", "Draft listing"],
      ["compliance_check", "Compliance check"],
      ["review", "Reviewer"],
      ["compliance_check", "Amazon's validation"],
      ["plan", "Listing for Amazon"],
      ["awaiting_approval", "Awaiting approval"],
    ]);
    expect(draftRun.llmCalls!.map((call) => [call.promptId, call.promptVersion, call.stepId])).toEqual([
      ["listing_writer.create", 2, `${draftRun.id}_draft1`],
      ["listing_reviewer.review", 1, `${draftRun.id}_review1`],
    ]);
  });

  it("fill attributes from the facts and the seller, and tell the writer the schema's limits and which claims it can't make", async () => {
    const { model, wizardBrief, draft, dataSource } = await setup();
    const filed = await draft(await wizardBrief());
    if (filed.outcome !== "filed") throw new Error(filed.outcome);

    const user = model.requests[0]!.user;
    expect(user).toContain('"titleMaxLength": 200');
    expect(user).toContain('"ref": "attributes.country_of_origin"');
    expect(user).toContain('"BPA free"');
    expect(user).toContain('"name": "item_type_keyword"');
    // Only what the facts don't fill goes to the writer.
    expect(user).not.toContain('"name": "brand"');
    // The reviewer reads the seller's values with their labels, as the writer did.
    expect(model.requests[1]!.user).toContain('"attributes.country_of_origin": "Country/Region of Origin: Vietnam"');

    const proposal = (await dataSource.getProposal(filed.proposalId))!;
    const sources = Object.fromEntries(proposal.diff.flatMap((entry) => (entry.path.startsWith("attributes.") ? [[entry.path.slice(11), (entry.after as { source: string }).source]] : [])));
    expect(sources).toMatchObject({ brand: "facts", material: "facts", item_dimensions: "facts", country_of_origin: "seller", item_name: "agent", item_type_keyword: "agent" });
  });

  it("stop with Amazon's reason when the seller is restricted from listing the ASIN", async () => {
    const restricted = (request: RecordedRequest) =>
      request.url.pathname === "/listings/2021-08-01/restrictions"
        ? json(200, {
            restrictions: [
              {
                marketplaceId: US,
                reasons: [
                  {
                    message: "You need approval to list in this brand.",
                    reasonCode: "APPROVAL_REQUIRED",
                    links: [{ resource: "https://sellercentral.amazon.com/hz/approvalrequest/restrictions/approve?asin=B0TRAILCR1", verb: "GET", title: "Request approval" }],
                  },
                ],
              },
            ],
          })
        : sandboxExamples(request);
    const { amazon, model, wizardBrief, draft, runOf } = await setup({ amazon: restricted });
    const result = await draft(await wizardBrief(SELLER_VALUES, { asin: "B0TRAILCR1" }));

    const reason =
      "Amazon restricts this ASIN: You need approval to list in this brand. Request approval: https://sellercentral.amazon.com/hz/approvalrequest/restrictions/approve?asin=B0TRAILCR1";
    expect(result).toEqual({ outcome: "stopped", runId: "run_nl_01JNEWLISTING", reason });
    expect(await runOf(result.runId)).toMatchObject({ status: "failed", error: reason });
    const [restrictions] = amazon.spApiRequests();
    expect(restrictions!.url.search).toContain("asin=B0TRAILCR1");
    expect(restrictions!.url.search).toContain("conditionType=new_new");
    expect(puts(amazon.spApiRequests())).toEqual([]);
    expect(model.requests).toEqual([]);
  });

  it("list the facts Amazon needs instead of inventing them", async () => {
    // Without a GTIN exemption the schema requires a GTIN, which the wizard doesn't collect.
    const { amazon, model, wizardBrief, draft, runOf } = await setup({
      model: scriptedModel({ draft: () => ({ ...groundedDraft(), attributes: [], missingFacts: [{ attribute: "item_type_keyword", need: "Say whether it is carry-on or checked luggage." }] }) }),
    });
    const result = await draft(await wizardBrief({ ...SELLER_VALUES, supplier_declared_has_product_identifier_exemption: "No" }));

    expect(result.outcome).toBe("stopped");
    if (result.outcome !== "stopped") throw new Error(result.outcome);
    expect(result.reason).toBe(
      "Amazon needs facts you haven't given: Item Type Keyword (Say whether it is carry-on or checked luggage.); External Product ID (Amazon requires the external product id for this product; the brief doesn't have it.) Add them to the brief and draft the listing again.",
    );
    const run = await runOf(result.runId);
    expect(run.steps!.at(-1)!.text).toContain("• External Product ID:");
    // Nothing more to ask a model or Amazon: only the seller can fill these.
    expect(model.requests).toHaveLength(1);
    expect(puts(amazon.spApiRequests())).toEqual([]);
  });

  it("revise a draft the guard rejects, with the failures as findings", async () => {
    const leaky = () => {
      const base = groundedDraft();
      return { ...base, listing: { ...base.listing, bullets: [...base.listing.bullets.slice(0, 2), "GRAPHITE FINISH – Comes in graphite, non-toxic paint."] } };
    };
    const { steps, wizardBrief, draft, runOf, model } = await setup({ model: scriptedModel({ draft: (round) => (round === 1 ? leaky() : groundedDraft()) }) });
    const result = await draft(await wizardBrief());

    expect(result.outcome).toBe("filed");
    expect(steps.filter((step) => /round/.test(step))).toEqual([
      "draft round 1",
      "check round 1",
      "review round 1",
      "record review round 1",
      "draft round 2",
      "check round 2",
      "review round 2",
      "record review round 2",
    ]);
    expect(model.requests[2]!.user).toMatch(/"severity": "error",\s+"message": "Title policy and prohibited claims: .*non-toxic/);
    const run = await runOf(result.runId);
    expect(run.steps!.filter((step) => step.kind === "draft").map((step) => step.title)).toEqual(["Draft listing", "Revised draft"]);
  });

  it("stop when the reviewer still blocks the draft after the last round", async () => {
    const blocking: PromptOutput<typeof PROMPTS.listingReview> = {
      ...goodReview,
      findings: [{ criterion: "title", severity: "error", message: "The title doesn't say what the product is for." }],
    };
    const { wizardBrief, draft, dataSource } = await setup({ model: scriptedModel({ review: () => blocking }) });
    const result = await draft(await wizardBrief());

    expect(result).toMatchObject({
      outcome: "stopped",
      reason: "The reviewer still blocks the draft after 2 rounds: The title doesn't say what the product is for.",
    });
    expect(await dataSource.listProposals({ workspaceId: merchant.id, type: "new_listing" })).toEqual([]);
  });

  it("record a retried step's draft once, without asking the model again", async () => {
    const { retry, wizardBrief, draft, runOf, model } = await setup();
    retry.add("check round 1");
    retry.add("record review round 1");
    const result = await draft(await wizardBrief());

    const run = await runOf(result.runId);
    expect(run.steps!.filter((step) => step.kind === "draft" || step.kind === "review")).toHaveLength(2);
    expect(run.llmCalls).toHaveLength(2);
    expect(model.requests).toHaveLength(2);
  });

  it("stop when Amazon's validation says the seller needs approval for the product", async () => {
    const gated = (request: RecordedRequest) =>
      request.method === "PUT" && request.url.searchParams.get("mode") === "VALIDATION_PREVIEW"
        ? json(200, {
            sku: "NL-1",
            status: "INVALID",
            submissionId: "preview-1",
            issues: [{ code: "8572", message: "You need approval to list products in this brand", severity: "ERROR", categories: ["QUALIFICATION_REQUIRED"] }],
          })
        : sandboxExamples(request);
    const { amazon, wizardBrief, draft, dataSource } = await setup({ amazon: gated });
    const result = await draft(await wizardBrief());

    expect(result).toMatchObject({ outcome: "stopped", reason: "Amazon requires approval before this seller can list this product: You need approval to list products in this brand." });
    expect(puts(amazon.spApiRequests())).toHaveLength(1);
    expect(await dataSource.listProposals({ workspaceId: merchant.id, type: "new_listing" })).toEqual([]);
  });

  it("announce a draft autonomy approved, since no member will", async () => {
    const { wizardBrief, draft, sent } = await setup({ autonomy: "L3" });
    const result = await draft(await wizardBrief());
    expect(result).toMatchObject({ outcome: "filed", status: "approved" });
    if (result.outcome !== "filed") throw new Error(result.outcome);
    expect(sent).toMatchObject([{ name: "announce the approval", events: [{ name: "app/proposal.decided", data: { proposalId: result.proposalId, status: "approved" } }] }]);
    expect(sent[0]!.events).toHaveLength(1);
  });

  it("submit only approved new listings, once", async () => {
    const { deps, amazon, run, wizardBrief, draft, dataSource } = await setup();
    const filed = await draft(await wizardBrief());
    if (filed.outcome !== "filed") throw new Error(filed.outcome);

    expect(await submitNewListing(deps, filed.proposalId, run)).toEqual({ outcome: "skipped", reason: "It is pending_approval, not approved." });
    await dataSource.rejectProposal({ proposalId: filed.proposalId, memberId: owner.id, reason: "We are not launching this yet." });
    expect(await submitNewListing(deps, filed.proposalId, run)).toEqual({ outcome: "skipped", reason: "It is rejected, not approved." });
    const listingUpdate = dataset.proposals.find((proposal) => proposal.type === "listing_update")!;
    expect(await submitNewListing(deps, listingUpdate.id, run)).toEqual({ outcome: "skipped", reason: "It isn't a new listing." });
    // Only the validation preview reached Amazon.
    expect(puts(amazon.spApiRequests()).map((put) => put.url.searchParams.get("mode"))).toEqual(["VALIDATION_PREVIEW"]);

    const second = await setup();
    const approved = await second.approved();
    await submitNewListing(second.deps, approved.proposalId, second.run);
    // The same approval announced again finds it submitted.
    expect(await submitNewListing(second.deps, approved.proposalId, second.run)).toEqual({ outcome: "skipped", reason: "It was already submitted." });
    expect(puts(second.amazon.spApiRequests()).map((put) => put.url.searchParams.get("mode"))).toEqual(["VALIDATION_PREVIEW", null]);
    expect(await approvedListingsToSubmit(second.deps)).toEqual([]);
  });

  it("fail a listing Amazon refuses, and one that couldn't be submitted at all", async () => {
    const refused = (request: RecordedRequest) =>
      request.method === "PUT" && request.url.searchParams.get("mode") === null
        ? json(200, { sku: "NL-1", status: "INVALID", submissionId: "sub-invalid", issues: [{ code: "90000900", message: "The attributes are invalid.", severity: "ERROR", categories: ["LISTING"] }] })
        : sandboxExamples(request);
    const first = await setup({ amazon: refused });
    const filed = await first.approved();
    expect(await submitNewListing(first.deps, filed.proposalId, first.run)).toMatchObject({ outcome: "submitted", submission: { status: "invalid" } });
    expect(await first.dataSource.getProposal(filed.proposalId)).toMatchObject({ status: "failed", listingSubmission: { status: "invalid", issues: [{ code: "90000900" }] } });

    // Submitting gave up (Amazon kept answering 500): the approved proposal fails with why.
    const down = await setup({ amazon: (request) => (request.method === "PUT" && request.url.searchParams.get("mode") === null ? json(500, { errors: [{ code: "InternalFailure", message: "We encountered an internal error." }] }) : sandboxExamples(request)) });
    const stuck = await down.approved();
    await expect(submitNewListing(down.deps, stuck.proposalId, down.run)).rejects.toThrow("putListingsItem failed with 500");
    expect(await approvedListingsToSubmit(down.deps)).toEqual([stuck.proposalId]);
    await failNewListingSubmission(down.deps, stuck.proposalId, "putListingsItem failed with 500: InternalFailure: We encountered an internal error.");
    const failed = await down.dataSource.getProposal(stuck.proposalId);
    expect(failed).toMatchObject({ status: "failed", listingSubmission: { status: "invalid", issues: [{ code: NOT_SUBMITTED, severity: "ERROR" }] } });
    expect(failed!.listingSubmission!.issues[0]!.message).toBe(
      "The listing couldn't be submitted to Amazon: putListingsItem failed with 500: InternalFailure: We encountered an internal error.",
    );
    expect(failed!.listingSubmission!.submissionId).toBeUndefined();
    // Once failed, there is nothing left to fail, and nothing for the sweep.
    await failNewListingSubmission(down.deps, stuck.proposalId, "again");
    expect(await down.dataSource.getProposal(stuck.proposalId)).toEqual(failed);
    expect(await approvedListingsToSubmit(down.deps)).toEqual([]);
  });

  it("follow a listing Amazon holds back, and ignore notifications about other listings", async () => {
    const { deps, run, approved, dataSource } = await setup();
    const filed = await approved();
    const submitted = await submitNewListing(deps, filed.proposalId, run);
    if (submitted.outcome !== "submitted") throw new Error(submitted.outcome);
    const change = { notificationType: "LISTINGS_ITEM_ISSUES_CHANGE" as const, sellerId, marketplaceId: US, sku: submitted.submission.sku };

    // The sandbox's listing has errors: recorded, and the listing kept back.
    expect(await trackNewListing(deps, change, run)).toMatchObject({ outcome: "tracked", submission: { status: "has_issues" } });
    expect((await dataSource.getProposal(filed.proposalId))!.listingSubmission!.issues.map((issue) => issue.code)).toContain("90220");

    expect(await trackNewListing(deps, { ...change, sku: "SOMEONE-ELSES" }, run)).toMatchObject({ outcome: "ignored" });
    expect(await trackNewListing(deps, { ...change, sellerId: "A9OTHERSELLER1" }, run)).toMatchObject({ outcome: "ignored" });
  });

  it("stop for an account that isn't connected to Amazon, and refuse members who can't run agents", async () => {
    const unconnected = await setup({ connected: false });
    const result = await unconnected.draft(await unconnected.wizardBrief());
    expect(result).toMatchObject({ outcome: "stopped", reason: expect.stringContaining("isn't connected to Amazon") });
    expect(await unconnected.runOf(result.runId)).toMatchObject({ status: "failed" });

    const { wizardBrief, draft } = await setup();
    await expect(draft(await wizardBrief(), viewer.id)).rejects.toMatchObject({ code: "forbidden" });
  });
});
