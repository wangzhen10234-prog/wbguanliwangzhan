"use client";

import { useEffect, useRef, useState } from "react";

const HORIZONTAL_SCROLL_SELECTOR = [
  "[data-horizontal-scroll]",
  ".table-wrap",
  ".product-detail-table-wrap",
  ".order-detail-table-wrap",
  ".finance-movement-table-wrap",
  ".pricing-table-scroll",
  ".promotion-table-wrap",
  ".returns-table-wrap",
  ".advertising-table-wrap",
  ".advertising-dialog-table-wrap",
  ".audit-table-wrap",
  ".price-table-wrap",
  ".review-table-wrap",
].join(",");

type ScrollState = {
  visible: boolean;
  left: number;
  max: number;
};

const INITIAL_STATE: ScrollState = { visible: false, left: 0, max: 0 };

function canScrollHorizontally(element: HTMLElement) {
  return element.clientWidth > 0 && element.scrollWidth - element.clientWidth > 5;
}

function visibleHeight(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
}

function nearestVisibleTarget(targets: HTMLElement[]) {
  let best: HTMLElement | null = null;
  let bestScore = -Infinity;
  for (const element of targets) {
    if (!canScrollHorizontally(element)) continue;
    const rect = element.getBoundingClientRect();
    const intersection = visibleHeight(element);
    if (intersection <= 0 || rect.width <= 0) continue;
    const centerDistance = Math.abs((rect.top + rect.bottom) / 2 - window.innerHeight / 2);
    const score = intersection * 1_000 - centerDistance;
    if (score > bestScore) {
      best = element;
      bestScore = score;
    }
  }
  return best;
}

export function HorizontalScrollController() {
  const activeTarget = useRef<HTMLElement | null>(null);
  const [state, setState] = useState<ScrollState>(INITIAL_STATE);

  useEffect(() => {
    let targets: HTMLElement[] = [];
    let animationFrame = 0;
    let shouldChooseTarget = true;
    const resizeObserver = new ResizeObserver(() => schedule(true));

    const sync = () => {
      animationFrame = 0;
      const current = activeTarget.current;
      if (
        shouldChooseTarget
        || !current
        || !canScrollHorizontally(current)
        || visibleHeight(current) <= 0
      ) {
        activeTarget.current = nearestVisibleTarget(targets);
      }
      shouldChooseTarget = false;

      const target = activeTarget.current;
      if (!target || !canScrollHorizontally(target) || visibleHeight(target) <= 0) {
        setState((previous) => previous.visible ? INITIAL_STATE : previous);
        return;
      }

      const max = Math.max(0, Math.round(target.scrollWidth - target.clientWidth));
      const left = Math.min(max, Math.max(0, Math.round(target.scrollLeft)));
      setState((previous) =>
        previous.visible && previous.left === left && previous.max === max
          ? previous
          : { visible: true, left, max },
      );
    };

    function schedule(chooseTarget = false) {
      shouldChooseTarget = shouldChooseTarget || chooseTarget;
      if (!animationFrame) animationFrame = window.requestAnimationFrame(sync);
    }

    const refreshTargets = () => {
      targets = Array.from(document.querySelectorAll<HTMLElement>(HORIZONTAL_SCROLL_SELECTOR));
      resizeObserver.disconnect();
      for (const target of targets) resizeObserver.observe(target);
      schedule(true);
    };

    const selectEventTarget = (event: Event) => {
      const origin = event.target instanceof Element ? event.target : null;
      const candidate = origin?.closest<HTMLElement>(HORIZONTAL_SCROLL_SELECTOR) ?? null;
      if (candidate && canScrollHorizontally(candidate)) {
        activeTarget.current = candidate;
        schedule();
      }
    };

    const handleScroll = (event: Event) => {
      const candidate = event.target instanceof HTMLElement ? event.target : null;
      if (candidate && targets.includes(candidate)) {
        activeTarget.current = candidate;
        schedule();
      } else {
        schedule(true);
      }
    };

    const mutationObserver = new MutationObserver(refreshTargets);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("pointerover", selectEventTarget, true);
    document.addEventListener("focusin", selectEventTarget, true);
    document.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", refreshTargets);
    refreshTargets();

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      document.removeEventListener("pointerover", selectEventTarget, true);
      document.removeEventListener("focusin", selectEventTarget, true);
      document.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", refreshTargets);
    };
  }, []);

  function setScrollLeft(nextLeft: number) {
    const target = activeTarget.current;
    if (!target) return;
    const left = Math.min(state.max, Math.max(0, nextLeft));
    target.scrollLeft = left;
    setState((previous) => ({ ...previous, left: Math.round(left) }));
  }

  function move(direction: -1 | 1) {
    const target = activeTarget.current;
    if (!target) return;
    const distance = Math.max(260, Math.round(target.clientWidth * 0.72));
    target.scrollBy({ left: direction * distance, behavior: "smooth" });
  }

  const progress = state.max > 0 ? Math.round(state.left / state.max * 100) : 0;

  return (
    <div
      className="site-horizontal-scroller"
      hidden={!state.visible}
      aria-hidden={!state.visible}
      aria-label="数据表左右滚动控制"
    >
      <span className="site-horizontal-scroller-label">左右滚动</span>
      <button type="button" onClick={() => move(-1)} disabled={state.left <= 1} aria-label="向左滚动数据表">‹</button>
      <input
        type="range"
        min={0}
        max={Math.max(1, state.max)}
        value={state.left}
        onChange={(event) => setScrollLeft(Number(event.target.value))}
        aria-label="拖动以左右查看数据"
        aria-valuetext={`已滚动 ${progress}%`}
      />
      <button type="button" onClick={() => move(1)} disabled={state.left >= state.max - 1} aria-label="向右滚动数据表">›</button>
      <small>{progress}%</small>
    </div>
  );
}
