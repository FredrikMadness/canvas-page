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
    // `initialZoom` multiplies the fitted zoom (1 = fit the board to the view).
    const initialZoom = parseFloat(container.dataset.initialZoom ?? "") || 1;
    let zoom = 1;
    let targetZoom = zoom;
    let zoomAnchorX = 0;
    let zoomAnchorY = 0;
    let zoomRaf = 0;
    let flyRaf = 0;
    let panX = 0;
    let panY = 0;
    let isPanning = false;
    let startX = 0;
    let startY = 0;

    const applyTransform = () => {
      viewport.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    };

    // Fit the whole board into the container with a 10% margin. The margin only
    // applies while the board is actually being scaled down — a board smaller
    // than the container renders at its natural size (zoom 1), not at 90%.
    const FIT_MARGIN = 0.9;

    const computeFit = () => {
      const containerRect = container.getBoundingClientRect();
      const vw = parseFloat(viewport.style.width) || 1000;
      const vh = parseFloat(viewport.style.height) || 1000;

      const scaleX = (containerRect.width / vw) * FIT_MARGIN;
      const scaleY = (containerRect.height / vh) * FIT_MARGIN;
      let fitZoom = Math.min(scaleX, scaleY, 1) * initialZoom;
      fitZoom = Math.max(minZoom, Math.min(maxZoom, fitZoom));

      return {
        zoom: fitZoom,
        panX: (containerRect.width - vw * fitZoom) / 2,
        panY: (containerRect.height - vh * fitZoom) / 2,
      };
    };

    const cancelFly = () => {
      if (flyRaf) {
        cancelAnimationFrame(flyRaf);
        flyRaf = 0;
      }
    };

    const centerViewport = () => {
      const fit = computeFit();
      zoom = fit.zoom;
      panX = fit.panX;
      panY = fit.panY;
      targetZoom = zoom;
      if (zoomRaf) {
        cancelAnimationFrame(zoomRaf);
        zoomRaf = 0;
      }
      cancelFly();
      applyTransform();
    };

    centerViewport();

    let defaultZoom = zoom;
    let defaultPanX = panX;
    let defaultPanY = panY;

    const resetBtn = container.querySelector(".canvas-reset-view") as HTMLButtonElement | null;

    const isAtDefaultView = () =>
      Math.abs(zoom - defaultZoom) <= 0.001 &&
      Math.abs(panX - defaultPanX) <= 1 &&
      Math.abs(panY - defaultPanY) <= 1;

    const updateResetButton = () => {
      if (!resetBtn) return;
      resetBtn.style.display = isAtDefaultView() ? "none" : "flex";
    };

    // Smooth (eased) zoom: pinches/wheel accumulate into `targetZoom`, and an
    // animation loop eases the live zoom toward it while keeping the focal point
    // (zoomAnchor) fixed — so zooming settles gently after the pinch stops
    // (Obsidian-like) instead of snapping to a halt on the last event.
    const ZOOM_SMOOTHING = 0.2;

    const stepZoom = () => {
      const prevZoom = zoom;
      zoom += (targetZoom - zoom) * ZOOM_SMOOTHING;
      if (Math.abs(targetZoom - zoom) < 0.0005) zoom = targetZoom;
      panX = zoomAnchorX - (zoomAnchorX - panX) * (zoom / prevZoom);
      panY = zoomAnchorY - (zoomAnchorY - panY) * (zoom / prevZoom);
      applyTransform();
      updateResetButton();
      zoomRaf = zoom === targetZoom ? 0 : requestAnimationFrame(stepZoom);
    };

    // Ease toward `targetZoom * factor`, keeping (cx, cy) — container-local
    // pixels — visually fixed (e.g. under the cursor).
    const zoomToward = (factor: number, cx: number, cy: number) => {
      cancelFly();
      targetZoom = Math.max(minZoom, Math.min(maxZoom, targetZoom * factor));
      zoomAnchorX = cx;
      zoomAnchorY = cy;
      if (!zoomRaf) zoomRaf = requestAnimationFrame(stepZoom);
    };

    // Fly (eased) to an absolute zoom/pan target — used by double-click focus
    // and the reset button. Runs its own loop; starting a fly cancels an
    // in-flight anchored zoom and vice versa, and any direct pan (drag, swipe,
    // touch) cancels the flight so the view never fights the user.
    let flyZoom = 1;
    let flyPanX = 0;
    let flyPanY = 0;

    const stepFly = () => {
      zoom += (flyZoom - zoom) * ZOOM_SMOOTHING;
      panX += (flyPanX - panX) * ZOOM_SMOOTHING;
      panY += (flyPanY - panY) * ZOOM_SMOOTHING;
      if (
        Math.abs(flyZoom - zoom) < 0.0005 &&
        Math.abs(flyPanX - panX) < 0.5 &&
        Math.abs(flyPanY - panY) < 0.5
      ) {
        zoom = flyZoom;
        panX = flyPanX;
        panY = flyPanY;
      }
      targetZoom = zoom;
      applyTransform();
      updateResetButton();
      flyRaf =
        zoom === flyZoom && panX === flyPanX && panY === flyPanY
          ? 0
          : requestAnimationFrame(stepFly);
    };

    const flyTo = (z: number, px: number, py: number) => {
      flyZoom = Math.max(minZoom, Math.min(maxZoom, z));
      flyPanX = px;
      flyPanY = py;
      if (zoomRaf) {
        cancelAnimationFrame(zoomRaf);
        zoomRaf = 0;
      }
      if (!flyRaf) flyRaf = requestAnimationFrame(stepFly);
    };

    // Fly the view to fit a card, capped so a small note doesn't blow up to
    // fill a large screen. Shared by double-click focus and #node=<id> links.
    const CARD_FIT_MARGIN = 0.8;
    const CARD_MAX_ZOOM = 2;

    const flyToCard = (card: HTMLElement) => {
      // Undo the current pan/zoom to get the card's world-space box, then
      // compute the zoom/pan that centers it with a margin.
      const containerRect = container.getBoundingClientRect();
      const rect = card.getBoundingClientRect();
      const wx = (rect.left - containerRect.left - panX) / zoom;
      const wy = (rect.top - containerRect.top - panY) / zoom;
      const ww = rect.width / zoom;
      const wh = rect.height / zoom;
      const z = Math.min(
        (containerRect.width / ww) * CARD_FIT_MARGIN,
        (containerRect.height / wh) * CARD_FIT_MARGIN,
        CARD_MAX_ZOOM,
      );
      flyTo(
        z,
        (containerRect.width - ww * z) / 2 - wx * z,
        (containerRect.height - wh * z) / 2 - wy * z,
      );
    };

    // Focusing a card puts a shareable #node=<id> in the URL (copy the address
    // bar to link straight to that card); unfocusing clears it. replaceState
    // keeps these updates out of the back-button history.
    const setNodeHash = (id?: string) => {
      const base = location.pathname + location.search;
      history.replaceState(null, "", id ? `${base}#node=${encodeURIComponent(id)}` : base);
    };

    const cleanupFns: Array<() => void> = [];

    // Keep the view sensible across container geometry changes — window
    // resizes, the sidebar opening/closing, entering/exiting fullscreen. An
    // untouched (default) view re-fits to the new size; a view the user has
    // moved stays visually anchored on screen by absorbing the container's
    // shift into the pan. The observer fires on every frame of the sidebar's
    // width transition, so anchoring tracks the animation instead of jumping.
    let lastRect = container.getBoundingClientRect();
    const onContainerResize = () => {
      const rect = container.getBoundingClientRect();
      if (
        rect.left === lastRect.left &&
        rect.top === lastRect.top &&
        rect.width === lastRect.width &&
        rect.height === lastRect.height
      ) {
        return;
      }

      const wasAtDefault = isAtDefaultView();
      panX -= rect.left - lastRect.left;
      panY -= rect.top - lastRect.top;
      lastRect = rect;

      const fit = computeFit();
      defaultZoom = fit.zoom;
      defaultPanX = fit.panX;
      defaultPanY = fit.panY;
      if (wasAtDefault) {
        centerViewport();
      } else {
        applyTransform();
      }
      updateResetButton();
    };

    const resizeObserver = new ResizeObserver(onContainerResize);
    resizeObserver.observe(container);
    cleanupFns.push(() => resizeObserver.disconnect());

    // Cards scroll only when their content meaningfully overflows. A near-fit
    // card (a few px of line-height rounding, e.g. a one-line heading in a
    // snug node) stays non-scrolling: no scrollbar, and wheel gestures over it
    // pan the canvas instead of being swallowed by a 1px "scroll". Genuinely
    // scrollable cards fade out at whichever edge still hides content (see
    // canvas.scss); each edge's fade lifts once scrolled to that extreme.
    const OVERFLOW_TOLERANCE = 4;

    const updateContentFades = (content: HTMLElement) => {
      content.classList.toggle("canvas-content-at-start", content.scrollTop <= 2);
      content.classList.toggle(
        "canvas-content-at-end",
        content.scrollTop + content.clientHeight >= content.scrollHeight - 2,
      );
    };

    const tagContentOverflow = (content: HTMLElement) => {
      content.classList.toggle(
        "canvas-content-scrollable",
        content.scrollHeight - content.clientHeight > OVERFLOW_TOLERANCE,
      );
      updateContentFades(content);
    };

    for (const content of Array.from(container.querySelectorAll(".canvas-node-content"))) {
      if (content instanceof HTMLElement) tagContentOverflow(content);
    }

    // Scroll and <img> load events don't bubble — capture them on the
    // container. A lazily-loaded image changes its card's height after init,
    // so re-tag that card when it arrives.
    const onContentScroll = (e: Event) => {
      if (e.target instanceof HTMLElement && e.target.classList.contains("canvas-node-content")) {
        updateContentFades(e.target);
      }
    };
    const onContentLoad = (e: Event) => {
      const content =
        e.target instanceof HTMLElement ? e.target.closest(".canvas-node-content") : null;
      if (content instanceof HTMLElement) tagContentOverflow(content);
    };
    container.addEventListener("scroll", onContentScroll, true);
    container.addEventListener("load", onContentLoad, true);
    cleanupFns.push(() => {
      container.removeEventListener("scroll", onContentScroll, true);
      container.removeEventListener("load", onContentLoad, true);
    });

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

      // Does `el` meaningfully overflow (beyond rounding tolerance) in the
      // gesture's dominant axis?
      const isScrollable = (el: HTMLElement, e: WheelEvent) =>
        Math.abs(e.deltaX) > Math.abs(e.deltaY)
          ? el.scrollWidth > el.clientWidth + OVERFLOW_TOLERANCE
          : el.scrollHeight > el.clientHeight + OVERFLOW_TOLERANCE;

      // Can `el` still scroll in the gesture's dominant direction (i.e. it's
      // scrollable and not already pinned at that edge)?
      const canScrollInDirection = (el: HTMLElement, e: WheelEvent) => {
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
          if (el.scrollWidth <= el.clientWidth + OVERFLOW_TOLERANCE) return false;
          if (el.scrollLeft <= 0 && e.deltaX < 0) return false;
          if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 && e.deltaX > 0) return false;
          return true;
        }
        if (el.scrollHeight <= el.clientHeight + OVERFLOW_TOLERANCE) return false;
        if (el.scrollTop <= 0 && e.deltaY < 0) return false;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1 && e.deltaY > 0) return false;
        return true;
      };

      // True while a Safari gesture (see below) is in progress, so wheel events
      // fired alongside it can't zoom a second time.
      let inGesture = false;

      const onWheel = (e: WheelEvent) => {
        if (inGesture) {
          e.preventDefault();
          return;
        }
        const rect = container.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;

        // Pinch (trackpad) or Ctrl/Cmd + wheel → zoom, always (a deliberate zoom).
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          zoomToward(zoomFactorFromWheel(e), cx, cy);
          return;
        }

        // Over a card whose content actually scrolls: keep the gesture inside
        // it — scroll while it can, then swallow the event at the edge so a
        // swipe/scroll can't "escape" the card. Cards that don't scroll (short
        // text, images) fall through so you can pan the canvas across them.
        const card =
          e.target instanceof HTMLElement
            ? e.target.closest(".canvas-node:not(.canvas-node-group)")
            : null;
        if (card) {
          const content = card.querySelector(".canvas-node-content");
          if (content instanceof HTMLElement && isScrollable(content, e)) {
            if (canScrollInDirection(content, e)) return; // let the browser scroll it
            e.preventDefault(); // pinned at the edge — don't escape
            return;
          }
        }

        // Empty canvas → pan (trackpad) or zoom (mouse).
        e.preventDefault();
        if (isTrackpadSwipe(e)) {
          cancelFly();
          panX -= e.deltaX;
          panY -= e.deltaY;
          applyTransform();
          updateResetButton();
        } else {
          zoomToward(zoomFactorFromWheel(e), cx, cy);
        }
      };

      const onPointerDown = (e: PointerEvent) => {
        const middle = e.button === 1;
        if (e.button !== 0 && !middle) return;

        if (middle) {
          // Middle-drag pans from anywhere; suppress the browser's middle-click
          // autoscroll (needs a non-passive pointerdown, which is the default).
          e.preventDefault();
        } else if (e.target instanceof HTMLElement) {
          // Left button: don't hijack links/buttons or a card's scrollbar.
          if (e.target.closest("a") || e.target.closest("button")) return;
          const scrollable = e.target.closest(".canvas-node-content");
          if (
            scrollable &&
            scrollable.scrollHeight > scrollable.clientHeight + OVERFLOW_TOLERANCE
          ) {
            const rect = scrollable.getBoundingClientRect();
            if (e.clientX >= rect.right - 16) return;
          }
        }

        cancelFly();
        isPanning = true;
        startX = e.clientX - panX;
        startY = e.clientY - panY;
        container.style.cursor = "grabbing";
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
        container.style.cursor = "";
      };

      // Cancel native drag-and-drop (e.g. of images) so a left-drag only pans
      // instead of the browser trying to drag the image at the same time.
      const onDragStart = (e: DragEvent) => e.preventDefault();

      container.addEventListener("wheel", onWheel, { passive: false });
      container.addEventListener("pointerdown", onPointerDown);
      container.addEventListener("pointermove", onPointerMove);
      container.addEventListener("pointerup", onPointerUp);
      // A cancelled pointer (interrupted touch, window switch) must end the pan
      // like a release would, or `isPanning` sticks and the next move pans.
      container.addEventListener("pointercancel", onPointerUp);
      container.addEventListener("dragstart", onDragStart);

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
          cancelFly();
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
          targetZoom = zoom; // touch pinch is direct; keep the eased target in sync

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

      // Safari on macOS doesn't synthesize ctrlKey wheel events for a trackpad
      // pinch like Chrome and Firefox do — it fires proprietary gesture events
      // carrying a cumulative `scale` instead, so without these handlers a
      // pinch zooms the page rather than the canvas. On iOS the same pinch
      // also arrives as a two-finger touch, which the touch handlers above
      // already zoom — `isTouchZooming` is set by then, so skip it here.
      type GestureEventLike = Event & { scale: number; clientX: number; clientY: number };
      let gestureStartZoom = 1;

      const onGestureStart = (e: Event) => {
        e.preventDefault();
        if (isTouchZooming) return;
        inGesture = true;
        gestureStartZoom = targetZoom;
      };

      const onGestureChange = (e: Event) => {
        e.preventDefault();
        if (!inGesture) return;
        const g = e as GestureEventLike;
        const rect = container.getBoundingClientRect();
        targetZoom = Math.max(minZoom, Math.min(maxZoom, gestureStartZoom * g.scale));
        zoomAnchorX = g.clientX - rect.left;
        zoomAnchorY = g.clientY - rect.top;
        if (!zoomRaf) zoomRaf = requestAnimationFrame(stepZoom);
      };

      const onGestureEnd = (e: Event) => {
        e.preventDefault();
        inGesture = false;
      };

      container.addEventListener("gesturestart", onGestureStart);
      container.addEventListener("gesturechange", onGestureChange);
      container.addEventListener("gestureend", onGestureEnd);

      // Double-click focuses: on a card (or group), fly the view to fit it and
      // put its #node=<id> in the URL; on the canvas background, fly back out
      // to the default fitted view. Links and buttons keep their behavior.
      const onDblClick = (e: MouseEvent) => {
        // Don't trust e.target: the pan handler's setPointerCapture retargets
        // the derived click/dblclick to the container, so every double-click
        // would look like one on the background. Hit-test the coordinates.
        const hit = document.elementFromPoint(e.clientX, e.clientY);
        if (!(hit instanceof HTMLElement)) return;
        if (hit.closest("a") || hit.closest("button")) return;

        const card = hit.closest(".canvas-node") as HTMLElement | null;
        if (!card) {
          flyTo(defaultZoom, defaultPanX, defaultPanY);
          setNodeHash();
          return;
        }

        flyToCard(card);
        setNodeHash(card.dataset.nodeId);
      };

      container.addEventListener("dblclick", onDblClick);

      cleanupFns.push(() => {
        container.removeEventListener("wheel", onWheel);
        container.removeEventListener("pointerdown", onPointerDown);
        container.removeEventListener("pointermove", onPointerMove);
        container.removeEventListener("pointerup", onPointerUp);
        container.removeEventListener("pointercancel", onPointerUp);
        container.removeEventListener("dragstart", onDragStart);
        container.removeEventListener("touchstart", onTouchStart);
        container.removeEventListener("touchmove", onTouchMove);
        container.removeEventListener("touchend", onTouchEnd);
        container.removeEventListener("gesturestart", onGestureStart);
        container.removeEventListener("gesturechange", onGestureChange);
        container.removeEventListener("gestureend", onGestureEnd);
        container.removeEventListener("dblclick", onDblClick);
      });
    }

    const sidebarToggle = frame?.querySelector(
      ".canvas-sidebar-toggle",
    ) as HTMLButtonElement | null;
    if (frame && sidebarToggle) {
      // The resize observer above handles the view: it re-fits an untouched
      // view into the new space and keeps a moved view anchored on screen.
      const toggleSidebar = () => {
        frame.classList.toggle("canvas-sidebar-open");
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
      zoomToward(factor, rect.width / 2, rect.height / 2);
    };

    cleanupFns.push(() => {
      if (zoomRaf) cancelAnimationFrame(zoomRaf);
      cancelFly();
    });

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
      // The default view is kept current by the resize observer, so resetting
      // is just an eased flight back to it (dropping any card deep link).
      const onReset = () => {
        flyTo(defaultZoom, defaultPanX, defaultPanY);
        setNodeHash();
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

    // #node=<id> deep link: opening the page with the hash written by
    // double-click focus flies from the initial fit to that card, so the
    // flight itself shows where on the board the card lives.
    const nodeHashMatch = /^#node=([^&]+)/.exec(location.hash);
    if (nodeHashMatch && nodeHashMatch[1]) {
      const linked = container.querySelector(
        `.canvas-node[data-node-id="${CSS.escape(decodeURIComponent(nodeHashMatch[1]))}"]`,
      );
      if (linked instanceof HTMLElement) flyToCard(linked);
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
