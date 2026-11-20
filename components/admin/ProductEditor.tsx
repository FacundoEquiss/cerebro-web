"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ImagePlus, Plus, Trash2, FileUp } from "lucide-react";
import { fill, paths, t } from "@/i18n";
import { generateVariants, productInputSchema, slugify } from "@/lib/admin/products";
import { commerce } from "@/config/commerce";
import { existingInstant, isEvent } from "@/lib/booking/slots";
import { selectionLabel } from "@/lib/data/availability";
import { PRODUCT_TYPES, type Category, type Product, type ProductImage, type ProductOption, type ProductType, type Variant, type Weekday } from "@/lib/data/types";
import { adminFetch } from "./api";
import { shrinkImage } from "./image";
import styles from "./ProductEditor.module.css";

const e = t.admin.editor;
const ERRORS = e.errors as Record<string, string>;

interface OptionDraft {
  id: string;
  name: string;
  /** What the person typed: "S, M, L". */
  values: string;
  swatches: Record<string, string>;
}

const toDraft = (o: ProductOption): OptionDraft => ({
  id: o.id,
  name: o.name,
  values: o.values.map((v) => v.label).join(", "),
  swatches: Object.fromEntries(o.values.flatMap((v) => (v.swatch ? [[v.id, v.swatch]] : []))),
});

function fromDrafts(drafts: OptionDraft[]): ProductOption[] {
  return drafts
    .map((d) => {
      const id = d.id || slugify(d.name);
      const seen = new Set<string>();
      const values = d.values.split(",").map((v) => v.trim()).filter(Boolean).flatMap((label) => {
        const valueId = slugify(label);
        if (!valueId || seen.has(valueId)) return [];
        seen.add(valueId);
        return [{ id: valueId, label, ...(d.swatches[valueId] ? { swatch: d.swatches[valueId] } : {}) }];
      });
      return { id, name: d.name.trim(), values };
    })
    .filter((o) => o.id && o.name && o.values.length > 0);
}

const numberOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

export function ProductEditor({ product, categories, isNew, canWrite }: { product: Product; categories: Category[]; isNew: boolean; canWrite: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(product.name);
  const [slug, setSlug] = useState(product.slug);
  const [slugTouched, setSlugTouched] = useState(!isNew);
  const [description, setDescription] = useState(product.description);
  const [category, setCategory] = useState(product.category);
  // A draft without a price starts EMPTY, not at 0: unticking «draft» must ask for the price.
  const [price, setPrice] = useState(isNew || (product.draft && product.price === 0) ? "" : String(product.price));
  const [compareAt, setCompareAt] = useState(product.compareAtPrice === null ? "" : String(product.compareAtPrice));
  const [stock, setStock] = useState(product.stock === null ? "" : String(product.stock));
  const [active, setActive] = useState(product.active);
  const [isDraft, setDraft] = useState(product.draft);
  const [isFree, setFree] = useState(product.free);
  const [featured, setFeatured] = useState(product.featured);
  const [images, setImages] = useState<ProductImage[]>(product.images);
  const [options, setOptions] = useState<OptionDraft[]>(product.options.map(toDraft));
  const [variants, setVariants] = useState<Variant[]>(product.variants);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const parsedOptions = fromDrafts(options);
  const productId = product.id || slug;

  function changeName(value: string) {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  async function addPhotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError("");
    for (const file of Array.from(files)) {
      try {
        const { blob, width, height } = await shrinkImage(file);
        const form = new FormData();
        form.set("file", blob, "photo");
        form.set("name", slug || name || "photo");
        const response = await fetch("/api/admin/upload", { method: "POST", body: form });
        const body = (await response.json().catch(() => ({}))) as { src?: string; error?: string };
        if (!response.ok || !body.src) {
          setError(response.status === 403 ? ERRORS.read_only! : response.status === 413 ? ERRORS.too_large! : ERRORS.upload!);
          continue;
        }
        setImages((list) => [...list, { src: body.src!, alt: "", width, height }]);
      } catch {
        setError(ERRORS.upload!);
      }
    }
    setUploading(false);
  }

  const patchImage = (i: number, patch: Partial<ProductImage>) => setImages((list) => list.map((img, n) => (n === i ? { ...img, ...patch } : img)));
  const patchOption = (i: number, patch: Partial<OptionDraft>) => setOptions((list) => list.map((o, n) => (n === i ? { ...o, ...patch } : o)));
  const patchVariant = (id: string, patch: Partial<Variant>) => setVariants((list) => list.map((v) => (v.id === id ? { ...v, ...patch } : v)));

  const [type, setType] = useState<ProductType>(product.type);
  const [unit, setUnit] = useState(product.unit);
  const [step, setStep] = useState(String(product.step));
  const [minQuantity, setMinQuantity] = useState(String(product.minQuantity));
  const [maxQuantity, setMaxQuantity] = useState(product.maxQuantity === null ? "" : String(product.maxQuantity));
  const [duration, setDuration] = useState(String(product.service?.durationMinutes ?? 60));
  const [capacity, setCapacity] = useState(String(product.service?.capacity ?? 1));
  // An event: its own dates instead of the weekly agenda. It stays an event with no date left.
  const [eventKind, setEventKind] = useState(isEvent(product));
  // One date per line ("2026-12-05 10:00"); a third number is the length of THAT date in minutes.
  const [sessionsText, setSessionsText] = useState((product.service?.sessions ?? []).map((x) => `${x.start.replace("T", " ")}${x.durationMinutes ? ` ${x.durationMinutes}` : ""}`).join("\n"));
  const repeat = product.service?.repeat;
  const [repeatWeek, setRepeatWeek] = useState(repeat ? String(repeat.week) : "");
  const [repeatWeekday, setRepeatWeekday] = useState<Weekday>(repeat?.weekday ?? "sat");
  const [repeatTime, setRepeatTime] = useState(repeat?.time ?? "10:00");
  const [repeatCount, setRepeatCount] = useState(String(repeat?.count ?? 3));
  const [moved, setMoved] = useState<{ slot: string; seats: number }[]>([]);
  // Days with no appointment and no event (`service.blockedDates`), on top of the store's closed days.
  const [skipText, setSkipText] = useState((product.service?.blockedDates ?? []).join(", "));
  const [migration, setMigration] = useState("");
  const [digital, setDigital] = useState(product.digital ?? { name: "", file: "" });
  const [fileBusy, setFileBusy] = useState(false);
  const pt = t.admin.productType;

  async function uploadFile(file: File | undefined) {
    if (!file) return;
    setFileBusy(true);
    setError("");
    const body = new FormData();
    body.set("file", file);
    body.set("name", file.name);
    const result = await adminFetch<{ file?: string; name?: string }>("/api/admin/upload-file", { method: "POST", body });
    setFileBusy(false);
    if (result.ok && result.data.file) setDigital({ file: result.data.file, name: digital.name || result.data.name || file.name });
    else setError(pt.fileError);
  }

  /** The dates as typed: unique, in order, each with its own length when one was written. */
  function typedSessions() {
    const seen = new Map<string, { start: string; durationMinutes?: number }>();
    for (const line of sessionsText.split(/\n+/)) {
      const [day, hour, minutes] = line.trim().split(/[\sT]+/);
      if (!day) continue;
      const start = `${day}T${hour ?? ""}`;
      const long = Number(minutes);
      if (!seen.has(start)) seen.set(start, { start, ...(minutes && Number.isFinite(long) ? { durationMinutes: long } : {}) });
    }
    return [...seen.values()].sort((x, y) => x.start.localeCompare(y.start));
  }

  const skipDates = () => [...new Set(skipText.split(/[\s,;]+/).map((d) => d.trim()).filter(Boolean))].sort();
  // What the owner typed that will NOT be offered, said before saving: a single date on a closed
  // day (the closed day wins), and a date at an hour the clocks skip that day.
  const closedDays = new Set([...commerce.booking.blockedDates, ...skipDates()]);
  const typed = eventKind ? typedSessions().filter((x) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(x.start)) : [];
  const skippedSessions = typed.filter((x) => closedDays.has(x.start.slice(0, 10)));
  const gapSessions = typed.filter((x) => !closedDays.has(x.start.slice(0, 10)) && existingInstant(x.start.slice(0, 10), x.start.slice(11), commerce.booking.timeZone) === null);

  /** The service as typed. «Event» keeps its list of dates even when it is empty; the weekly agenda has none. */
  function serviceDraft() {
    const { sessions: _old, repeat: _rule, blockedDates: _skip, ...rest } = product.service ?? { durationMinutes: 60, capacity: 1 };
    const skip = skipDates();
    const base = { ...rest, durationMinutes: Number(duration) || 60, capacity: Number(capacity) || 1, ...(skip.length > 0 ? { blockedDates: skip } : {}) };
    if (!eventKind) return base;
    const week = repeatWeek === "last" || repeatWeek === "every" ? repeatWeek : ([1, 2, 3, 4] as const).find((n) => String(n) === repeatWeek);
    return { ...base, sessions: typedSessions(), ...(week ? { repeat: { week, weekday: repeatWeekday, time: repeatTime, count: Number(repeatCount) || 3 } } : {}) };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaved(false);
    if (images.some((img) => img.alt.trim().length < 3)) {
      setError(e.altRequired);
      return;
    }
    // Variants only make sense for the options that still exist.
    const validVariants = variants.filter((v) => parsedOptions.every((o) => o.values.some((val) => val.id === v.options[o.id])) && Object.keys(v.options).length === parsedOptions.length);
    const draft = {
      ...(product.id ? { id: product.id } : {}),
      slug: slug.trim(),
      name: name.trim(),
      description: description.trim(),
      category,
      // A draft may have no price yet: it is stored as 0 and never sold.
      price: (isDraft || isFree || type === "quote") && price.trim() === "" ? 0 : Number(price),
      compareAtPrice: numberOrNull(compareAt),
      stock: parsedOptions.length > 0 ? null : numberOrNull(stock),
      featured,
      active,
      draft: isDraft,
      free: isFree && type !== "quote",
      minQuantity: Number(minQuantity) || 1,
      type,
      unit: unit.trim() || "u",
      step: Number(step) || 1,
      maxQuantity: numberOrNull(maxQuantity),
      // Opening hours of its own (set in the catalogue file or by an agent) are kept as they are.
      service: type === "service" ? serviceDraft() : null,
      digital: type === "digital" ? { name: digital.name.trim() || "download", ...(digital.file ? { file: digital.file } : {}) } : null,
      attributes: product.attributes,
      images: images.map((img) => ({ ...img, alt: img.alt.trim() })),
      options: parsedOptions,
      variants: validVariants,
    };
    const parsed = productInputSchema.safeParse(draft);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(issue?.message === "price_required" ? ERRORS.price_required! : issue?.message === "free_has_price" ? ERRORS.free_has_price! : fill(ERRORS.invalid!, { field: String(issue?.path[0] ?? "") }));
      return;
    }
    setSaving(true);
    setError("");
    const result = await adminFetch<{ product?: Product; moved?: { slot: string; seats: number }[]; migration?: string }>("/api/admin/products", { json: parsed.data });
    setSaving(false);
    if (!result.ok || !result.data.product) {
      const code = result.data.error ?? "generic";
      setError(code === "needs_migration" ? fill(ERRORS.needs_migration!, { migration: result.data.migration ?? "" }) : code === "invalid" ? (result.data.field === "price" ? ERRORS.price_required! : fill(ERRORS.invalid!, { field: result.data.field ?? "" })) : (ERRORS[code] ?? ERRORS.generic!));
      return;
    }
    setSaved(true);
    setMoved(result.data.moved ?? []);
    setMigration(result.data.migration ?? "");
    if (isNew) router.replace(`/admin/products/${encodeURIComponent(result.data.product.id)}`);
    else router.refresh();
  }

  return (
    <form onSubmit={submit} className={styles.form} noValidate data-testid="product-form">
      <div className="admin-head">
        <Link href="/admin/products" className={styles.back}><ArrowLeft aria-hidden size={17} /> {e.back}</Link>
      </div>
      <div className="admin-head">
        <h1>{isNew ? e.newTitle : e.editTitle}</h1>
        {!isNew && product.active && !product.draft ? <Link href={paths.product(product.slug)} target="_blank" className="btn btn-secondary">{t.admin.products.viewInStore}</Link> : null}
      </div>

      <section className={`admin-card ${styles.block}`} aria-labelledby="editor-basics">
        <h2 id="editor-basics">{e.basics}</h2>
        <div className="field">
          <label htmlFor="p-name">{e.name}</label>
          <input id="p-name" className="input" value={name} onChange={(ev) => changeName(ev.target.value)} required maxLength={160} data-testid="p-name" />
        </div>
        <div className="field">
          <label htmlFor="p-slug">{e.slug}</label>
          <input id="p-slug" className="input" value={slug} onChange={(ev) => { setSlug(slugify(ev.target.value)); setSlugTouched(true); }} required aria-describedby="p-slug-hint" data-testid="p-slug" />
          <p id="p-slug-hint" className="admin-note">{e.slugHint}</p>
        </div>
        <div className="field">
          <label htmlFor="p-description">{e.description}</label>
          <textarea id="p-description" className="input" rows={4} value={description} onChange={(ev) => setDescription(ev.target.value)} maxLength={5000} data-testid="p-description" />
        </div>
        <div className={styles.three}>
          <div className="field">
            <label htmlFor="p-category">{e.category}</label>
            <select id="p-category" className="input" value={category} onChange={(ev) => setCategory(ev.target.value)} data-testid="p-category">
              {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="p-price">{e.price}</label>
            <input id="p-price" className="input" type="number" min={0} step="any" inputMode="decimal" value={price} onChange={(ev) => setPrice(ev.target.value)} required={!isDraft && !isFree} disabled={isFree && type !== "quote"} placeholder={isFree && type !== "quote" ? t.common.free : undefined} data-testid="p-price" />
          </div>
          <div className="field">
            <label htmlFor="p-compare">{e.compareAt}</label>
            <input id="p-compare" className="input" type="number" min={0} step="any" inputMode="decimal" value={compareAt} onChange={(ev) => setCompareAt(ev.target.value)} aria-describedby="p-compare-hint" data-testid="p-compare" />
            <p id="p-compare-hint" className="admin-note">{e.compareHint}</p>
          </div>
        </div>
        <div className={styles.checks}>
          <label><input type="checkbox" checked={active} onChange={(ev) => setActive(ev.target.checked)} data-testid="p-active" /> {e.active}</label>
          <label><input type="checkbox" checked={isDraft} onChange={(ev) => setDraft(ev.target.checked)} data-testid="p-draft" /> {e.draft}</label>
          <label><input type="checkbox" checked={featured} onChange={(ev) => setFeatured(ev.target.checked)} /> {e.featured}</label>
          {type !== "quote" ? (
            <label title={pt.freeHint}>
              <input type="checkbox" checked={isFree} onChange={(ev) => { setFree(ev.target.checked); if (ev.target.checked) setPrice(""); }} data-testid="p-free" /> {pt.free}
            </label>
          ) : null}
        </div>
        {isFree && type !== "quote" ? <p className="admin-note">{pt.freeHint}</p> : null}
      </section>

      <section className={`admin-card ${styles.block}`} aria-labelledby="editor-type" data-testid="editor-type">
        <h2 id="editor-type">{pt.section}</h2>
        <div className="field">
          <label htmlFor="p-type">{pt.label}</label>
          <select id="p-type" className="input" value={type} onChange={(ev) => setType(ev.target.value as ProductType)} data-testid="p-type">
            {PRODUCT_TYPES.map((k) => <option key={k} value={k}>{pt[k]}</option>)}
          </select>
        </div>
        {type === "physical" || type === "quote" ? (
          <div className={styles.grid3}>
            <div className="field">
              <label htmlFor="p-unit">{pt.unit}</label>
              <input id="p-unit" className="input" value={unit} onChange={(ev) => setUnit(ev.target.value)} maxLength={12} list="p-units" data-testid="p-unit" />
              <datalist id="p-units">{["u", "kg", "g", "l", "ml", "m", "cm", "m²"].map((u) => <option key={u} value={u} />)}</datalist>
            </div>
            <div className="field">
              <label htmlFor="p-step">{pt.step}</label>
              <input id="p-step" className="input" type="number" inputMode="decimal" min={0.001} step="any" value={step} onChange={(ev) => setStep(ev.target.value)} data-testid="p-step" />
            </div>
            <div className="field">
              <label htmlFor="p-min">{pt.min}</label>
              <input id="p-min" className="input" type="number" inputMode="decimal" min={0.001} step="any" value={minQuantity} onChange={(ev) => setMinQuantity(ev.target.value)} data-testid="p-min" />
            </div>
            <div className="field">
              <label htmlFor="p-max">{pt.max}</label>
              <input id="p-max" className="input" type="number" inputMode="decimal" min={0} step="any" value={maxQuantity} onChange={(ev) => setMaxQuantity(ev.target.value)} placeholder="—" />
            </div>
          </div>
        ) : null}
        {type === "physical" || type === "quote" ? <p className="admin-note">{type === "quote" ? pt.quoteHint : `${pt.unitHint} ${pt.maxHint}`}</p> : null}
        {type === "service" ? (
          <>
            <div className={styles.grid3}>
              <div className="field">
                <label htmlFor="p-duration">{pt.duration}</label>
                <input id="p-duration" className="input" type="number" inputMode="numeric" min={5} step={5} value={duration} onChange={(ev) => setDuration(ev.target.value)} data-testid="p-duration" />
              </div>
              <div className="field">
                <label htmlFor="p-capacity">{pt.capacity}</label>
                <input id="p-capacity" className="input" type="number" inputMode="numeric" min={1} step={1} value={capacity} onChange={(ev) => setCapacity(ev.target.value)} data-testid="p-capacity" />
              </div>
            </div>
            <div className="field">
              <label htmlFor="p-agenda">{pt.agenda}</label>
              <select id="p-agenda" className="input" value={eventKind ? "event" : "weekly"} onChange={(ev) => setEventKind(ev.target.value === "event")} data-testid="p-agenda">
                <option value="weekly">{pt.agendaWeekly}</option>
                <option value="event">{pt.agendaEvent}</option>
              </select>
            </div>
            {eventKind ? (
              <>
                <div className={styles.grid3}>
                  <div className="field">
                    <label htmlFor="p-repeat-week">{pt.repeat}</label>
                    <select id="p-repeat-week" className="input" value={repeatWeek} onChange={(ev) => setRepeatWeek(ev.target.value)} data-testid="p-repeat-week">
                      <option value="">{pt.repeatNone}</option>
                      {(["1", "2", "3", "4", "last", "every"] as const).map((w) => <option key={w} value={w}>{pt.repeatWeeks[w]}</option>)}
                    </select>
                  </div>
                  {repeatWeek ? (
                    <>
                      <div className="field">
                        <label htmlFor="p-repeat-weekday">{pt.repeatWeekday}</label>
                        <select id="p-repeat-weekday" className="input" value={repeatWeekday} onChange={(ev) => setRepeatWeekday(ev.target.value as Weekday)} data-testid="p-repeat-weekday">
                          {(["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const).map((d) => <option key={d} value={d}>{pt.weekdays[d]}</option>)}
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor="p-repeat-time">{pt.repeatTime}</label>
                        <input id="p-repeat-time" className="input" type="time" value={repeatTime} onChange={(ev) => setRepeatTime(ev.target.value)} data-testid="p-repeat-time" />
                      </div>
                      <div className="field">
                        <label htmlFor="p-repeat-count">{pt.repeatCount}</label>
                        <input id="p-repeat-count" className="input" type="number" inputMode="numeric" min={1} max={24} step={1} value={repeatCount} onChange={(ev) => setRepeatCount(ev.target.value)} data-testid="p-repeat-count" />
                      </div>
                    </>
                  ) : null}
                </div>
                <div className="field">
                  <label htmlFor="p-sessions">{pt.sessions}</label>
                  <textarea id="p-sessions" className="input" rows={3} value={sessionsText} onChange={(ev) => setSessionsText(ev.target.value)} placeholder={"2027-03-06 10:00\n2027-04-03 10:00 90"} aria-describedby="p-sessions-hint" data-testid="p-sessions" />
                </div>
                <p id="p-sessions-hint" className="admin-note">{pt.sessionsHint}</p>
                {!repeatWeek && sessionsText.trim() === "" ? <p className="admin-banner" data-testid="p-no-dates">{pt.noOpenDates}</p> : null}
              </>
            ) : <p className="admin-note">{pt.serviceHint}</p>}
            <div className="field">
              <label htmlFor="p-skip">{pt.skipDates}</label>
              <input id="p-skip" className="input" value={skipText} onChange={(ev) => setSkipText(ev.target.value)} placeholder="2027-01-02, 2027-05-01" aria-describedby="p-skip-hint" data-testid="p-skip" />
              <p id="p-skip-hint" className="admin-note">{pt.skipDatesHint}</p>
            </div>
            {skippedSessions.length > 0 ? <p className="admin-banner" data-testid="p-skipped-sessions">{pt.skippedSessions} {skippedSessions.map((x) => x.start.replace("T", " ")).join(" · ")}</p> : null}
            {gapSessions.length > 0 ? <p className="admin-banner" data-testid="p-gap-sessions">{pt.gapSessions} {gapSessions.map((x) => x.start.replace("T", " ")).join(" · ")}</p> : null}
          </>
        ) : null}
        {type === "digital" ? (
          <>
            <div className="field">
              <label htmlFor="p-file-name">{pt.fileName}</label>
              <input id="p-file-name" className="input" value={digital.name} onChange={(ev) => setDigital({ ...digital, name: ev.target.value })} maxLength={200} placeholder="guia.pdf" data-testid="p-file-name" />
            </div>
            <p className="admin-note" data-testid="p-file-state">{digital.file ? pt.fileCurrent : pt.fileMissing} {pt.digitalHint}</p>
            <label className={`btn btn-secondary ${styles.upload}`} aria-disabled={fileBusy || !canWrite || undefined}>
              <FileUp aria-hidden size={18} /> {fileBusy ? pt.fileUploading : pt.fileUpload}
              <input type="file" className="sr-only" disabled={fileBusy || !canWrite} onChange={(ev) => { void uploadFile(ev.target.files?.[0]); ev.target.value = ""; }} data-testid="p-file" />
            </label>
          </>
        ) : null}
      </section>

      <section className={`admin-card ${styles.block}`} aria-labelledby="editor-photos">
        <h2 id="editor-photos">{e.photos}</h2>
        <p className="admin-note">{e.photoHint}</p>
        <ul className={styles.photos}>
          {images.map((img, i) => (
            <li key={img.src}>
              <img src={img.src} alt="" width={88} height={110} />
              <div className={styles.photoFields}>
                <div className="field">
                  <label htmlFor={`p-alt-${i}`}>{e.alt}</label>
                  <input id={`p-alt-${i}`} className="input" value={img.alt} onChange={(ev) => patchImage(i, { alt: ev.target.value })} placeholder={e.altHint} maxLength={200} aria-invalid={img.alt.trim().length < 3 || undefined} data-testid="p-alt" />
                </div>
                {parsedOptions.length > 0 ? (
                  <div className="field">
                    <label htmlFor={`p-for-${i}`}>{e.photoFor}</label>
                    <select
                      id={`p-for-${i}`}
                      className="input"
                      value={img.option ? Object.entries(img.option).map(([k, v]) => `${k}=${v}`)[0] : ""}
                      onChange={(ev) => {
                        const [k, v] = ev.target.value.split("=");
                        const { option: _drop, ...rest } = img;
                        setImages((list) => list.map((it, n) => (n === i ? (k && v ? { ...rest, option: { [k]: v } } : rest) : it)));
                      }}
                    >
                      <option value="">{e.photoForNone}</option>
                      {parsedOptions.flatMap((o) => o.values.map((v) => <option key={`${o.id}=${v.id}`} value={`${o.id}=${v.id}`}>{o.name}: {v.label}</option>))}
                    </select>
                  </div>
                ) : null}
              </div>
              <button type="button" className={styles.remove} onClick={() => setImages((list) => list.filter((_, n) => n !== i))} aria-label={e.removePhoto}>
                <Trash2 aria-hidden size={18} />
              </button>
            </li>
          ))}
        </ul>
        <label className={`btn btn-secondary ${styles.upload}`} aria-disabled={uploading || !canWrite || undefined}>
          <ImagePlus aria-hidden size={18} /> {uploading ? e.uploading : e.addPhoto}
          <input type="file" accept="image/*" multiple className="sr-only" disabled={uploading || !canWrite} onChange={(ev) => { void addPhotos(ev.target.files); ev.target.value = ""; }} data-testid="p-photo" />
        </label>
      </section>

      <section className={`admin-card ${styles.block}`} aria-labelledby="editor-options">
        <h2 id="editor-options">{e.options}</h2>
        <p className="admin-note">{e.optionsHint}</p>
        {options.map((o, i) => (
          <div key={i} className={styles.option}>
            <div className="field">
              <label htmlFor={`p-option-${i}`}>{e.optionName}</label>
              <input id={`p-option-${i}`} className="input" value={o.name} onChange={(ev) => patchOption(i, { name: ev.target.value })} maxLength={60} data-testid="p-option-name" />
            </div>
            <div className="field">
              <label htmlFor={`p-values-${i}`}>{e.optionValues}</label>
              <input id={`p-values-${i}`} className="input" value={o.values} onChange={(ev) => patchOption(i, { values: ev.target.value })} placeholder="S, M, L" data-testid="p-option-values" />
            </div>
            <button type="button" className={styles.remove} onClick={() => setOptions((list) => list.filter((_, n) => n !== i))} aria-label={e.removeOption}>
              <Trash2 aria-hidden size={18} />
            </button>
          </div>
        ))}
        {options.length < 3 ? (
          <button type="button" className="btn btn-secondary" onClick={() => setOptions((list) => [...list, { id: "", name: "", values: "", swatches: {} }])} data-testid="p-add-option">
            <Plus aria-hidden size={18} /> {e.addOption}
          </button>
        ) : null}
      </section>

      {parsedOptions.length === 0 ? (
        <section className={`admin-card ${styles.block}`} aria-labelledby="editor-stock">
          <h2 id="editor-stock">{e.stock}</h2>
          <div className="field" style={{ maxWidth: 220 }}>
            <label htmlFor="p-stock">{e.stock}</label>
            <input id="p-stock" className="input" type="number" min={0} step={1} inputMode="numeric" value={stock} onChange={(ev) => setStock(ev.target.value)} aria-describedby="p-stock-hint" data-testid="p-stock" />
            <p id="p-stock-hint" className="admin-note">{e.stockHint}</p>
          </div>
        </section>
      ) : (
        <section className={`admin-card ${styles.block}`} aria-labelledby="editor-variants">
          <h2 id="editor-variants">{e.variants}</h2>
          <div className={styles.row}>
            <button type="button" className="btn btn-secondary" onClick={() => setVariants(generateVariants(productId || "product", parsedOptions, variants))} data-testid="p-generate">{e.generate}</button>
            {variants.length > 0 ? <button type="button" className="btn btn-ghost" onClick={() => setVariants([])}>{e.clearVariants}</button> : null}
          </div>
          {variants.length === 0 ? (
            <p className="admin-note">{e.variantsEmpty}</p>
          ) : (
            <table className="admin-table" data-testid="p-variants">
              <thead><tr><th>{e.variants}</th><th>{e.stock}</th><th>{e.variantPrice}</th></tr></thead>
              <tbody>
                {variants.map((v) => {
                  const label = selectionLabel({ options: parsedOptions } as Product, v.options) || v.id;
                  return (
                    <tr key={v.id}>
                      <td><strong>{label}</strong></td>
                      <td data-label={e.stock}>
                        <input className={styles.small} type="number" min={0} step={1} inputMode="numeric" value={v.stock ?? ""} placeholder={t.admin.products.madeToOrder} aria-label={`${e.stock} ${label}`} onChange={(ev) => patchVariant(v.id, { stock: ev.target.value === "" ? null : Math.max(0, Number(ev.target.value)) })} />
                      </td>
                      <td data-label={e.variantPrice}>
                        <input className={styles.small} type="number" min={0} step="any" inputMode="decimal" value={v.price ?? ""} placeholder={price} aria-label={`${e.variantPrice} ${label}`} onChange={(ev) => patchVariant(v.id, { price: ev.target.value === "" ? null : Number(ev.target.value) })} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}

      <div className={styles.footer}>
        <div aria-live="assertive">
          {error ? <p className="field-error" role="alert" data-testid="p-error">{error}</p> : null}
          {saved ? <p className={styles.saved} data-testid="p-saved">{e.saved}</p> : null}
          {saved && migration ? <p className="admin-banner" role="status" data-testid="p-migration">{fill(pt.migrationWarning, { migration })}</p> : null}
          {moved.length > 0 ? (
            <p className="admin-banner" role="alert" data-testid="p-moved">
              {pt.sessionsMoved} {moved.map((m) => `${m.slot.replace("T", " ")} (${fill(t.admin.agenda.seats, { n: m.seats })})`).join(" · ")}
            </p>
          ) : null}
          {!canWrite ? <p className="admin-note">{t.admin.readOnly}</p> : null}
        </div>
        <button type="submit" className="btn" aria-disabled={saving || undefined} data-testid="p-save">{saving ? e.saving : e.save}</button>
      </div>
    </form>
  );
}
