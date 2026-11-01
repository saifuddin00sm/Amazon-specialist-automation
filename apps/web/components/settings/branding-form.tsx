"use client";

import { BrandingSchema, DEFAULT_BRANDING, type Branding, type Workspace } from "@app/core";
import { ImageUp, Loader2, RotateCcw, X } from "lucide-react";
import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { updateBranding } from "@/app/(app)/settings/actions";
import { ReportHeader } from "@/components/reports/report-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Largest logo file, before it becomes a data URL (which is about a third bigger). */
const LOGO_MAX_BYTES = 100 * 1024;
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

/**
 * Report branding for one workspace: header name, logo and two colors, with a live preview of the
 * report header. Only owners can save; everyone else sees it read-only.
 */
export function BrandingForm({ workspace, canEdit }: { workspace: Workspace; canEdit: boolean }) {
  const saved = workspace.branding;
  const [displayName, setDisplayName] = useState(saved?.displayName ?? "");
  const [logo, setLogo] = useState(saved?.logo);
  const [primaryColor, setPrimaryColor] = useState(saved?.primaryColor ?? DEFAULT_BRANDING.primaryColor);
  const [accentColor, setAccentColor] = useState(saved?.accentColor ?? DEFAULT_BRANDING.accentColor);
  const [saving, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const id = useId();

  const draft: Branding = {
    ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
    ...(logo ? { logo } : {}),
    primaryColor,
    accentColor,
  };
  const parsed = BrandingSchema.safeParse(draft);
  const error = parsed.success ? undefined : parsed.error.issues[0]?.message;
  const changed = JSON.stringify(draft) !== JSON.stringify(saved ?? { primaryColor: DEFAULT_BRANDING.primaryColor, accentColor: DEFAULT_BRANDING.accentColor });

  const save = (branding: Branding | null) =>
    startTransition(async () => {
      const result = await updateBranding({ workspaceId: workspace.id, branding });
      if (result.ok) toast.success(branding ? "Report branding saved" : "Report branding reset to the default");
      else toast.error(result.message);
    });

  const reset = () => {
    setDisplayName("");
    setLogo(undefined);
    setPrimaryColor(DEFAULT_BRANDING.primaryColor);
    setAccentColor(DEFAULT_BRANDING.accentColor);
    save(null);
  };

  const pickLogo = (file: File | undefined) => {
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) {
      toast.error("Use a PNG, JPEG, WebP or SVG image.");
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      toast.error("Use an image under 100 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setLogo(reader.result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (parsed.success) save(parsed.data);
      }}
    >
      {/* On paper, like the report: a dark header stays visible in dark mode. */}
      <div className="paper rounded-lg border p-3">
        <ReportHeader
          branding={{ ...draft, displayName: draft.displayName ?? workspace.name }}
          title="Weekly performance report"
          subtitle="Client account · Amazon US"
          period="Preview"
        />
      </div>

      <fieldset disabled={!canEdit || saving} className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor={`${id}-name`}>Name in the header</Label>
          <Input
            id={`${id}-name`}
            value={displayName}
            maxLength={80}
            placeholder={workspace.name}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor={`${id}-logo`}>Logo</Label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              id={`${id}-logo`}
              type="file"
              accept={LOGO_TYPES.join(",")}
              className="sr-only"
              onChange={(event) => {
                pickLogo(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
              <ImageUp />
              {logo ? "Replace logo" : "Upload logo"}
            </Button>
            {logo && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setLogo(undefined)}>
                <X />
                Remove
              </Button>
            )}
            <span className="text-xs text-muted-foreground">PNG, JPEG, WebP or SVG, up to 100 KB. Wide logos work best.</span>
          </div>
        </div>

        <ColorField id={`${id}-primary`} label="Header color" value={primaryColor} onChange={setPrimaryColor} />
        <ColorField id={`${id}-accent`} label="Accent color" value={accentColor} onChange={setAccentColor} />
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        {canEdit ? (
          <>
            <Button type="submit" disabled={!changed || Boolean(error) || saving}>
              {saving && <Loader2 className="animate-spin" />}
              Save branding
            </Button>
            <Button type="button" variant="ghost" disabled={saving || !saved} onClick={reset}>
              <RotateCcw />
              Use default
            </Button>
            {error && <span className="text-sm text-destructive">{error}</span>}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Only workspace owners can change report branding.</p>
        )}
      </div>
    </form>
  );
}

function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          className="h-9 w-12 cursor-pointer rounded-md border bg-transparent p-1 disabled:cursor-not-allowed"
          value={valid ? value.toLowerCase() : "#000000"}
          onChange={(event) => onChange(event.target.value)}
        />
        <Input id={id} value={value} maxLength={7} className="w-28 font-mono uppercase" onChange={(event) => onChange(event.target.value.trim())} />
      </div>
    </div>
  );
}
