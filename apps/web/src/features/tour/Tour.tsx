import { Button, Dialog, DialogContent } from "@gachipad/ui";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDragCapable } from "../../lib/appearance";
import { useT } from "../../lib/i18n";
import { useDocumentPermissions, useEditor } from "../editor/context";
import { DropIllustration } from "./DropIllustration";
import { type Placement, placePopover, popoverWidth } from "./place";
import { markTourSeen } from "./seen";
import { anchorOf, availableSteps, type Box, bodyOf, boxOf, type TourAnchor } from "./steps";
import "./tour.css";

/** Room around the highlighted element inside the spotlight. */
const SPOT_PAD = 4;
/** After closing, how long the exit animation (the slowest token is 260ms) gets before unmounting. */
const EXIT_MS = 400;

function sameBox(a: Box | null, b: Box): boolean {
  return (
    a !== null &&
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height
  );
}

export interface TourProps {
  /** Skip or Done: the tour counts as seen. */
  onFinish: () => void;
  /** The exit animation is over; the caller can unmount. */
  onExited: () => void;
}

/**
 * The first-run tour: a modal popover that points at real controls with a spotlight. Steps whose
 * element is not on screen are left out. It is imported only when it runs; the service worker
 * still precaches it, so it is downloaded once per build for offline use.
 */
export default function Tour({ onFinish, onExited }: TourProps) {
  const t = useT();
  const ctx = useEditor();
  const [open, setOpen] = useState(true);
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  // Bumped when the window resizes: which steps fit and where they sit may change.
  const [revision, setRevision] = useState(0);
  const [currentId, setCurrentId] = useState<TourAnchor | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [place, setPlace] = useState<Placement | null>(null);
  const [announce, setAnnounce] = useState("");
  const primary = useRef<HTMLButtonElement>(null);
  const announced = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision stands for the screen changing
  const steps = useMemo(() => availableSteps(ctx.readOnly), [ctx.readOnly, revision]);
  const index = Math.max(
    0,
    steps.findIndex((candidate) => candidate.id === currentId),
  );
  const step = steps[index];
  const last = index === steps.length - 1;
  const touchOnly = !useDragCapable();
  const limited = !useDocumentPermissions().files;
  const body = step ? t(bodyOf(step, { limited, touchOnly })) : "";

  const close = useCallback(
    (seen: boolean) => {
      setOpen(false);
      if (seen) {
        markTourSeen();
        onFinish();
      }
    },
    [onFinish],
  );

  useEffect(() => {
    const onResize = () => setRevision((count) => count + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Nothing left to point at (the window shrank, the panel changed): leave without counting it as seen.
  useEffect(() => {
    if (open && !step) close(false);
  }, [open, step, close]);

  useEffect(() => {
    if (open) return;
    const timer = window.setTimeout(onExited, EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open, onExited]);

  // Measure before paint, so the popover never shows at a stale place.
  const stepId = step?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision stands for the screen changing
  useLayoutEffect(() => {
    const target = stepId ? anchorOf(stepId) : null;
    if (!open || !target || !content) return;
    // The status bar scrolls sideways at 320px: bring the element into view first.
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
    const measure = () => {
      const next = boxOf(target);
      setBox((previous) => (sameBox(previous, next) ? previous : next));
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const placement = placePopover(
        next,
        { width: popoverWidth(viewport), height: content.offsetHeight },
        viewport,
      );
      setPlace((previous) =>
        previous &&
        previous.left === placement.left &&
        previous.top === placement.top &&
        previous.side === placement.side
          ? previous
          : placement,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const element of [target, target.parentElement, content]) {
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [open, stepId, content, revision]);

  // Focus stays on the main button across steps, so Enter walks through the tour.
  useEffect(() => {
    if (open && stepId) primary.current?.focus();
  }, [open, stepId]);

  useEffect(() => {
    if (!step) return;
    // The dialog announces itself when it opens; only later steps need the live region.
    if (!announced.current) {
      announced.current = true;
      return;
    }
    setAnnounce(
      t("tour.announce", {
        current: index + 1,
        total: steps.length,
        title: t(step.title),
        body,
      }),
    );
  }, [step, index, steps.length, t, body]);

  if (!step) return null;
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  // A full-width element (the file tabs) would push its padding off the screen.
  const spot = box && {
    left: Math.max(0, box.left - SPOT_PAD),
    top: Math.max(0, box.top - SPOT_PAD),
    right: Math.min(viewport.width, box.left + box.width + SPOT_PAD),
    bottom: Math.min(viewport.height, box.top + box.height + SPOT_PAD),
  };
  const go = (to: number) => {
    const next = steps[to];
    if (next) setCurrentId(next.id);
  };

  return (
    <>
      {open && spot
        ? createPortal(
            <div
              aria-hidden="true"
              className="tour-spot"
              data-testid="tour-spot"
              style={{
                left: spot.left,
                top: spot.top,
                width: spot.right - spot.left,
                height: spot.bottom - spot.top,
              }}
            />,
            document.body,
          )
        : null}
      <Dialog open={open} onOpenChange={(next) => !next && close(true)}>
        <DialogContent
          ref={setContent}
          size="sm"
          scrim={false}
          title={t(step.title)}
          description={body}
          closeLabel={t("common.close")}
          className="tour-pop"
          data-testid="tour"
          data-tour=""
          data-side={place?.side}
          data-placed={place ? "" : undefined}
          style={{
            inset: "0 auto auto 0",
            margin: 0,
            width: popoverWidth(viewport),
            translate: place ? `${place.left}px ${place.top}px` : undefined,
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            primary.current?.focus();
          }}
          // Clicking the dimmed page neither closes the tour nor reaches the page.
          onInteractOutside={(event) => event.preventDefault()}
          footer={
            <>
              {last ? null : (
                <Button
                  variant="ghost"
                  className="me-auto"
                  onClick={() => close(true)}
                  data-testid="tour-skip"
                >
                  {t("tour.skipAction")}
                </Button>
              )}
              {index > 0 ? (
                <Button onClick={() => go(index - 1)} data-testid="tour-back">
                  {t("tour.backAction")}
                </Button>
              ) : null}
              <Button
                ref={primary}
                variant="primary"
                onClick={() => (last ? close(true) : go(index + 1))}
                data-testid="tour-next"
              >
                {last ? t("tour.doneAction") : t("tour.nextAction")}
              </Button>
            </>
          }
        >
          {step.illustration === "drop" && !limited && !touchOnly ? <DropIllustration /> : null}
          <p className="text-caption text-fg-3 tabular" data-testid="tour-step">
            {t("tour.step", { current: index + 1, total: steps.length })}
          </p>
          <p role="status" className="sr-only">
            {announce}
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
