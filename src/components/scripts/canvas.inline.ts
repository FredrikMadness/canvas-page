function initCanvas() {
  const containers = document.querySelectorAll(".canvas-container") as NodeListOf<HTMLElement>;
  if (containers.length === 0) return;

  for (const container of Array.from(containers)) {
    if (container.dataset.initialized === "true") continue;
    container.dataset.initialized = "true";

    const viewport = container.querySelector(".canvas-viewport") as HTMLElement | null;
    if (!viewport) continue;

    const enableInteraction = container.dataset.enableInteraction !== "false";
    const defaultFullscreen = container.dataset.defaultFullscreen === "true";
    const frame = container.closest('.page[data-frame="canvas"]') as HTMLElement | null;

    // Show the sidebar by default; `defaultFullscreen` opts a canvas into
    // starting with it hidden (canvas fills the viewport). Skipped on narrow
    // (mobile) viewports, where the sidebar is nearly full-width (see the
    // max-width: 800px breakpoint in canvas.scss) and would cover the canvas.
    // Applied before centering so the initial fit accounts for the sidebar's
    // width. All transitions in the frame are disabled for this first layout so
    // the sidebar is simply *present* rather than sliding/animating in, then
    // re-enabled so manual toggles still animate.
    const isNarrowViewport = window.matchMedia("(max-width: 800px)").matches;
    if (frame && !defaultFullscreen && !isNarrowViewport) {
      frame.classList.add("canvas-init-no-transition", "canvas-sidebar-open");
      void frame.offsetWidth; // force reflow so the open layout commits with no transition
      requestAnimationFrame(() => {
        frame.classList.remove("canvas-init-no-transition");
      });
    }

    const minZoom = parseFloat(container.dataset.minZoom ?? "") || 0.1;
    const maxZoom = parseFloat(container.dataset.maxZoom ?? "") || 5;
    let zoom = parseFloat(container.dataset.initialZoom ?? "") || 1;
    let panX = 0;
    let panY = 0;
    let isPanning = false;
    let startX = 0;
    let startY = 0;

    const applyTransform = () => {
      viewport.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    };

    const centerViewport = () => {
      const containerRect = container.getBoundingClientRect();
      const vw = parseFloat(viewport.style.width) || 1000;
      const vh = parseFloat(viewport.style.height) || 1000;

      const scaleX = containerRect.width / vw;
      const scaleY = containerRect.height / vh;
      zoom = Math.min(scaleX, scaleY, 1) * 0.9;
      zoom = Math.max(minZoom, Math.min(maxZoom, zoom));

      panX = (containerRect.width - vw * zoom) / 2;
      panY = (containerRect.height - vh * zoom) / 2;
      applyTransform();
    };

    centerViewport();

    let defaultZoom = zoom;
    let defaultPanX = panX;
    let defaultPanY = panY;

    const resetBtn = container.querySelector(".canvas-reset-view") as HTMLButtonElement | null;

    const updateResetButton = () => {
      if (!resetBtn) return;
      const changed =
        Math.abs(zoom - defaultZoom) > 0.001 ||
        Math.abs(panX - defaultPanX) > 1 ||
        Math.abs(panY - defaultPanY) > 1;
      resetBtn.style.display = changed ? "flex" : "none";
    };

    // Zoom by `factor`, keeping the point (cx, cy) — in container-local pixels —
    // visually fixed (e.g. under the cursor).
    const zoomAt = (factor: number, cx: number, cy: number) => {
      const prevZoom = zoom;
      zoom = Math.max(minZoom, Math.min(maxZoom, zoom * factor));
      panX = cx - (cx - panX) * (zoom / prevZoom);
      panY = cy - (cy - panY) * (zoom / prevZoom);
      applyTransform();
      updateResetButton();
    };

    const cleanupFns: Array<() => void> = [];

    if (enableInteraction) {
      // Wheel-zoom speed knobs (higher = faster):
      //  - sensitivity scales smooth pixel-mode zoom (trackpad pinch, most mice)
      //  - step is the per-notch factor for coarse line/page mode (e.g. FF mouse)
      const ZOOM_WHEEL_SENSITIVITY = 0.004;
      const ZOOM_WHEEL_STEP = 1.3;

      // Wheel input maps to three behaviours, matching Obsidian: a trackpad
      // *pinch* (or Ctrl/Cmd + wheel) zooms, a trackpad *two-finger swipe* pans,
      // and a *mouse wheel* zooms. Pinch is unambiguous (the browser sets
      // ctrlKey); telling a swipe from a mouse wheel is a heuristic, since both
      // arrive as plain wheel events.
      const zoomFactorFromWheel = (e: WheelEvent) =>
        e.deltaMode !== 0
          ? e.deltaY > 0
            ? 1 / ZOOM_WHEEL_STEP
            : ZOOM_WHEEL_STEP // line/page mode (e.g. Firefox mouse wheel)
          : Math.exp(-e.deltaY * ZOOM_WHEEL_SENSITIVITY); // pixel mode

      // Heuristic: mouse wheels report coarse, vertical-only, integer steps;
      // trackpads report fine/fractional deltas, often with a horizontal
      // component. Accepted trade-off: a fine-resolution mouse or a hard flick
      // can occasionally be misread.
      const isTrackpadSwipe = (e: WheelEvent) => {
        if (e.deltaMode !== 0) return false; // coarse line/page steps → mouse wheel
        if (e.deltaX !== 0) return true; // horizontal component → trackpad
        if (!Number.isInteger(e.deltaY)) return true; // fractional pixels → trackpad
        return Math.abs(e.deltaY) < 40; // small steps → trackpad; coarse → mouse wheel
      };

      // Can `el` still scroll in the gesture's dominant direction (i.e. it's
      // scrollable and not already pinned at that edge)?
      const canScrollInDirection = (el: HTMLElement, e: WheelEvent) => {
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
          if (el.scrollWidth <= el.clientWidth) return false;
          if (el.scrollLeft <= 0 && e.deltaX < 0) return false;
          if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 && e.deltaX > 0) return false;
          return true;
        }
        if (el.scrollHeight <= el.clientHeight) return false;
        if (el.scrollTop <= 0 && e.deltaY < 0) return false;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1 && e.deltaY > 0) return false;
        return true;
      };

      const onWheel = (e: WheelEvent) => {
        const rect = container.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;

        // Pinch (trackpad) or Ctrl/Cmd + wheel → zoom, always (a deliberate zoom).
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          zoomAt(zoomFactorFromWheel(e), cx, cy);
          return;
        }

        // Over a node (but not a group container): keep the gesture inside the
        // card. Scroll its content if it can; otherwise swallow the event. Never
        // pan/zoom the canvas from over a card, so a swipe or scroll can't
        // "escape" the card once it hits the top/bottom.
        const card =
          e.target instanceof HTMLElement
            ? e.target.closest(".canvas-node:not(.canvas-node-group)")
            : null;
        if (card) {
          const content = card.querySelector(".canvas-node-content");
          if (content instanceof HTMLElement && canScrollInDirection(content, e)) {
            return; // let the browser scroll the card
          }
          e.preventDefault(); // consume — don't move the canvas
          return;
        }

        // Empty canvas → pan (trackpad) or zoom (mouse).
        e.preventDefault();
        if (isTrackpadSwipe(e)) {
          panX -= e.deltaX;
          panY -= e.deltaY;
          applyTransform();
          updateResetButton();
        } else {
          zoomAt(zoomFactorFromWheel(e), cx, cy);
        }
      };

      const onPointerDown = (e: PointerEvent) => {
        if (e.button !== 0) return;
        if (e.target instanceof HTMLElement) {
          if (e.target.closest("a") || e.target.closest("button")) return;
        }

        // Don't start panning when clicking on a scrollbar
        if (e.target instanceof HTMLElement) {
          const scrollable = e.target.closest(".canvas-node-content");
          if (scrollable && scrollable.scrollHeight > scrollable.clientHeight) {
            const rect = scrollable.getBoundingClientRect();
            if (e.clientX >= rect.right - 16) return;
          }
        }

        isPanning = true;
        startX = e.clientX - panX;
        startY = e.clientY - panY;
        container.setPointerCapture(e.pointerId);
      };

      const onPointerMove = (e: PointerEvent) => {
        if (!isPanning) return;
        panX = e.clientX - startX;
        panY = e.clientY - startY;
        applyTransform();
        updateResetButton();
      };

      const onPointerUp = () => {
        isPanning = false;
      };

      container.addEventListener("wheel", onWheel, { passive: false });
      container.addEventListener("pointerdown", onPointerDown);
      container.addEventListener("pointermove", onPointerMove);
      container.addEventListener("pointerup", onPointerUp);

      let lastTouchDist = 0;
      let lastTouchMidX = 0;
      let lastTouchMidY = 0;
      let isTouchZooming = false;

      const getTouchDistance = (touches: TouchList) => {
        if (touches.length < 2 || !touches[0] || !touches[1]) return 0;
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
      };

      const onTouchStart = (e: TouchEvent) => {
        if (e.touches.length === 2) {
          const first = e.touches[0];
          const second = e.touches[1];
          if (!first || !second) return;
          e.preventDefault();
          isTouchZooming = true;
          isPanning = false;
          lastTouchDist = getTouchDistance(e.touches);
          lastTouchMidX = (first.clientX + second.clientX) / 2;
          lastTouchMidY = (first.clientY + second.clientY) / 2;
        }
      };

      const onTouchMove = (e: TouchEvent) => {
        if (e.touches.length === 2 && isTouchZooming) {
          const first = e.touches[0];
          const second = e.touches[1];
          if (!first || !second) return;
          e.preventDefault();
          const dist = getTouchDistance(e.touches);
          const midX = (first.clientX + second.clientX) / 2;
          const midY = (first.clientY + second.clientY) / 2;

          const rect = container.getBoundingClientRect();
          const cx = midX - rect.left;
          const cy = midY - rect.top;

          const scale = dist / lastTouchDist;
          const prevZoom = zoom;
          zoom = Math.max(minZoom, Math.min(maxZoom, zoom * scale));

          panX = cx - (cx - panX) * (zoom / prevZoom);
          panY = cy - (cy - panY) * (zoom / prevZoom);

          panX += midX - lastTouchMidX;
          panY += midY - lastTouchMidY;

          lastTouchDist = dist;
          lastTouchMidX = midX;
          lastTouchMidY = midY;
          applyTransform();
          updateResetButton();
        }
      };

      const onTouchEnd = (e: TouchEvent) => {
        if (e.touches.length < 2) {
          isTouchZooming = false;
        }
      };

      container.addEventListener("touchstart", onTouchStart, { passive: false });
      container.addEventListener("touchmove", onTouchMove, { passive: false });
      container.addEventListener("touchend", onTouchEnd);

      cleanupFns.push(() => {
        container.removeEventListener("wheel", onWheel);
        container.removeEventListener("pointerdown", onPointerDown);
        container.removeEventListener("pointermove", onPointerMove);
        container.removeEventListener("pointerup", onPointerUp);
        container.removeEventListener("touchstart", onTouchStart);
        container.removeEventListener("touchmove", onTouchMove);
        container.removeEventListener("touchend", onTouchEnd);
      });
    }

    const sidebarToggle = frame?.querySelector(
      ".canvas-sidebar-toggle",
    ) as HTMLButtonElement | null;
    if (frame && sidebarToggle) {
      const toggleSidebar = () => {
        const oldRect = container.getBoundingClientRect();
        frame.classList.toggle("canvas-sidebar-open");

        requestAnimationFrame(() => {
          const newRect = container.getBoundingClientRect();
          const shiftX = newRect.left - oldRect.left;
          panX += shiftX;
          defaultPanX += shiftX;
          applyTransform();
          updateResetButton();
        });
      };

      sidebarToggle.addEventListener("click", toggleSidebar);

      cleanupFns.push(() => {
        sidebarToggle.removeEventListener("click", toggleSidebar);
      });
    }

    const zoomInBtn = container.querySelector(".canvas-zoom-in") as HTMLButtonElement | null;
    const zoomOutBtn = container.querySelector(".canvas-zoom-out") as HTMLButtonElement | null;

    const zoomAtCenter = (factor: number) => {
      const rect = container.getBoundingClientRect();
      zoomAt(factor, rect.width / 2, rect.height / 2);
    };

    if (zoomInBtn) {
      const onZoomIn = () => {
        zoomAtCenter(1.25);
      };
      zoomInBtn.addEventListener("click", onZoomIn);
      cleanupFns.push(() => zoomInBtn.removeEventListener("click", onZoomIn));
    }

    if (zoomOutBtn) {
      const onZoomOut = () => {
        zoomAtCenter(0.8);
      };
      zoomOutBtn.addEventListener("click", onZoomOut);
      cleanupFns.push(() => zoomOutBtn.removeEventListener("click", onZoomOut));
    }

    if (resetBtn) {
      const onReset = () => {
        centerViewport();
        defaultZoom = zoom;
        defaultPanX = panX;
        defaultPanY = panY;
        updateResetButton();
      };
      resetBtn.addEventListener("click", onReset);
      cleanupFns.push(() => resetBtn.removeEventListener("click", onReset));
    }

    // Fullscreen toggle for embedded canvases
    const fullscreenBtn = container.querySelector(
      ".canvas-fullscreen-toggle",
    ) as HTMLButtonElement | null;
    if (fullscreenBtn) {
      const enterIcon = fullscreenBtn.querySelector(
        ".canvas-fullscreen-enter",
      ) as HTMLElement | null;
      const exitIcon = fullscreenBtn.querySelector(".canvas-fullscreen-exit") as HTMLElement | null;

      const updateFullscreenIcons = () => {
        const isFs = document.fullscreenElement === container;
        if (enterIcon) enterIcon.style.display = isFs ? "none" : "";
        if (exitIcon) exitIcon.style.display = isFs ? "" : "none";
      };

      const onFullscreenToggle = () => {
        if (document.fullscreenElement === container) {
          document.exitFullscreen();
        } else {
          container.requestFullscreen();
        }
      };

      const onFullscreenChange = () => {
        updateFullscreenIcons();
        // Re-center after entering/exiting fullscreen
        requestAnimationFrame(() => {
          centerViewport();
          defaultZoom = zoom;
          defaultPanX = panX;
          defaultPanY = panY;
          updateResetButton();
        });
      };

      fullscreenBtn.addEventListener("click", onFullscreenToggle);
      document.addEventListener("fullscreenchange", onFullscreenChange);
      cleanupFns.push(() => {
        fullscreenBtn.removeEventListener("click", onFullscreenToggle);
        document.removeEventListener("fullscreenchange", onFullscreenChange);
      });
    }

    // Handle iframe load errors (CSP/X-Frame-Options blocks)
    const iframes = container.querySelectorAll(
      ".canvas-iframe-wrapper iframe",
    ) as NodeListOf<HTMLIFrameElement>;
    for (const iframe of Array.from(iframes)) {
      iframe.addEventListener("error", () => {
        const fallback = iframe.parentElement?.querySelector(
          ".canvas-iframe-fallback",
        ) as HTMLElement | null;
        if (fallback) {
          iframe.style.display = "none";
          fallback.style.display = "flex";
        }
      });
    }

    if (typeof window !== "undefined" && window.addCleanup) {
      window.addCleanup(() => {
        for (const fn of cleanupFns) fn();
        container.dataset.initialized = "false";
      });
    }
  }
}

if (typeof document !== "undefined") {
  const handleCanvasInit = () => {
    initCanvas();
  };
  document.addEventListener("nav", handleCanvasInit);
  document.addEventListener("render", handleCanvasInit);
}
