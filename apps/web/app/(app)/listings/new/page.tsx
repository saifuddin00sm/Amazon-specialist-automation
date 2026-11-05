import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { NewListingWizard } from "@/components/listings/new-listing-wizard";

export const metadata: Metadata = { title: "New listing" };

export default function NewListingPage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6">
      <Link href="/listings" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Listings
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">New listing</h1>
        <p className="text-sm text-muted-foreground">
          Describe a product that isn&apos;t on Amazon yet and pick its product type. The listing creator drafts the listing for approval;
          nothing is listed on Amazon until it&apos;s approved.
        </p>
      </div>
      <NewListingWizard />
    </div>
  );
}
