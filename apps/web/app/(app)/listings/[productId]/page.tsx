import { canActOnAccount, type ListingVersion, type ProductFacts } from "@app/core";
import { getDataSource } from "@app/data";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AIGeneratedBadge } from "@/components/ai-generated-badge";
import { OptimizerPanel } from "@/components/listings/optimizer-panel";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Product" };

export default function ProductPage({ params }: PageProps<"/listings/[productId]">) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6">
      <Link href="/listings" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Listings
      </Link>
      <Suspense fallback={<ProductSkeleton />}>
        <ProductView params={params} />
      </Suspense>
    </div>
  );
}

/** Request time: runs and proposals change while you watch. */
async function ProductView({ params }: { params: PageProps<"/listings/[productId]">["params"] }) {
  await connection();
  const { productId } = await params;
  const dataSource = getDataSource();
  const product = await dataSource.getProduct(productId);
  const account = product && (await dataSource.getSellerAccount(product.sellerAccountId));
  if (!product || !account) notFound();

  const [facts, versions, runs, pending, member] = await Promise.all([
    dataSource.getProductFacts(product.id),
    dataSource.listListingVersions(product.id),
    dataSource.listAgentRuns({ workspaceId: account.workspaceId, subjectId: product.id, limit: 1 }),
    dataSource.listProposals({ workspaceId: account.workspaceId, status: "pending_approval", type: "listing_update" }),
    dataSource.getActingMember(account.workspaceId),
  ]);
  const live = versions.find((version) => version.status === "live");
  const pendingProposal = pending.find((proposal) => proposal.target.id === product.id);

  return (
    <>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{product.category}</Badge>
          <Badge variant={product.status === "active" ? "outline" : "destructive"} className="capitalize">
            {product.status}
          </Badge>
          <Badge variant="outline">{account.name}</Badge>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{product.title}</h1>
        <p className="text-sm text-muted-foreground tabular-nums">
          ASIN {product.asin} · SKU {product.sku} · {formatMoney(product.price, account.currency)}
        </p>
      </header>

      <section className="flex flex-col gap-3" aria-labelledby="optimizer-heading">
        <h2 id="optimizer-heading" className="text-lg font-semibold">
          Listing optimizer
        </h2>
        <OptimizerPanel
          productId={product.id}
          latestRun={runs[0]}
          pendingProposalId={pendingProposal?.id}
          canRun={Boolean(
            member && live && canActOnAccount(member, { workspaceId: account.workspaceId, sellerAccountId: account.id }),
          )}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        {live ? <LiveListing version={live} /> : <p className="text-sm text-muted-foreground">No live listing.</p>}
        <div className="flex flex-col gap-6">
          {facts && <FactsCard facts={facts} />}
          <VersionHistory versions={versions} />
        </div>
      </div>
    </>
  );
}

function LiveListing({ version }: { version: ListingVersion }) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border bg-card p-4" aria-labelledby="live-heading">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="live-heading" className="text-sm font-semibold">
          Live listing · v{version.version}
        </h2>
        <AIGeneratedBadge actor={version.createdBy} />
        <span className="ml-auto text-xs text-muted-foreground">Since {formatDateTime(version.createdAt)}</span>
      </div>
      <Field label="Title">{version.title}</Field>
      <Field label="Bullet points">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          {version.bullets.map((bullet, i) => (
            <li key={i}>{bullet}</li>
          ))}
        </ul>
      </Field>
      <Field label="Description">{version.description}</Field>
      <Field label="Backend search terms">{version.backendKeywords || "None"}</Field>
    </section>
  );
}

function FactsCard({ facts }: { facts: ProductFacts }) {
  const { lengthCm, widthCm, heightCm } = facts.dimensions;
  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-sm" aria-labelledby="facts-heading">
      <h2 id="facts-heading" className="font-semibold">
        ProductFacts
      </h2>
      <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5">
        <dt className="text-muted-foreground">Material</dt>
        <dd>{facts.material}</dd>
        <dt className="text-muted-foreground">Color</dt>
        <dd>{facts.color}</dd>
        <dt className="text-muted-foreground">Size</dt>
        <dd className="tabular-nums">
          {lengthCm} × {widthCm} × {heightCm} cm
        </dd>
        <dt className="text-muted-foreground">Weight</dt>
        <dd className="tabular-nums">{facts.weightGrams} g</dd>
        <dt className="text-muted-foreground">In the box</dt>
        <dd>{facts.includedComponents.join(", ")}</dd>
        <dt className="text-muted-foreground">Never claim</dt>
        <dd className="text-destructive">{facts.prohibitedClaims.join(", ")}</dd>
      </dl>
    </section>
  );
}

function VersionHistory({ versions }: { versions: ListingVersion[] }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-sm" aria-labelledby="versions-heading">
      <h2 id="versions-heading" className="font-semibold">
        Versions
      </h2>
      <ul className="flex flex-col gap-2">
        {versions.map((version) => (
          <li key={version.id} className="flex flex-wrap items-center gap-2">
            <span className="font-medium tabular-nums">v{version.version}</span>
            <Badge variant="outline" className="capitalize">
              {version.status}
            </Badge>
            <AIGeneratedBadge actor={version.createdBy} compact />
            <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(version.createdAt)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</h3>
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}

function ProductSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading product">
      <Skeleton className="h-16 w-2/3" />
      <Skeleton className="h-64" />
      <Skeleton className="h-96" />
    </div>
  );
}
