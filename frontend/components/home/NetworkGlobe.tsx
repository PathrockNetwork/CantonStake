"use client";

import { useEffect, useRef, useState } from "react";
import { decodeLand } from "./globe-geometry";
import { createGlobeRenderer, type GlobeRenderer } from "./globe-renderer";

/** Procedural globe: geographic points, elevated routes and light packets drawn in JS. */
export function NetworkGlobe() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GlobeRenderer | null>(null);
  const [ready, setReady] = useState(false);
  const [motionAllowed, setMotionAllowed] = useState(false);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const playing = ready && motionAllowed && inView && pageVisible;

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setMotionAllowed(!preference.matches);
    const syncVisibility = () => setPageVisible(document.visibilityState === "visible");
    syncPreference();
    syncVisibility();
    preference.addEventListener("change", syncPreference);
    document.addEventListener("visibilitychange", syncVisibility);
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.05 });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => {
      preference.removeEventListener("change", syncPreference);
      document.removeEventListener("visibilitychange", syncVisibility);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = createGlobeRenderer(canvas);
    if (!renderer) return;
    rendererRef.current = renderer;
    const resize = () => renderer.resize(canvas.getBoundingClientRect().width, window.devicePixelRatio || 1);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    window.addEventListener("resize", resize);
    setReady(true);
    const controller = new AbortController();
    // Only static longitude/latitude coordinates are loaded. Every frame is drawn locally.
    void fetch("/globe-land.bin", { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error("Globe coordinates unavailable");
        return response.arrayBuffer();
      })
      .then(data => renderer.setLand(decodeLand(data)))
      .catch(() => { /* The procedural wireframe and routes remain usable without land data. */ });
    return () => {
      controller.abort();
      observer.disconnect();
      window.removeEventListener("resize", resize);
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (playing) rendererRef.current?.start();
    else rendererRef.current?.stop();
  }, [playing]);

  return (
    <>
      <div ref={containerRef} className={`home-globe${ready ? " home-globe--ready" : ""}`} aria-hidden="true">
        <svg className="home-globe__fallback" viewBox="0 0 620 620" fill="none" stroke="#00bf8c" strokeWidth=".7" opacity=".35">
          <circle cx="310" cy="286" r="240" />
          {[80, 160].map(radius => <ellipse key={radius} cx="310" cy="286" rx={radius} ry="240" />)}
          {[-120, 0, 120].map(offset => <ellipse key={offset} cx="310" cy={286 + offset} rx={Math.sqrt(240 ** 2 - offset ** 2)} ry="38" />)}
        </svg>
        <canvas ref={canvasRef} className="home-globe__canvas" width="620" height="620" />
      </div>
    </>
  );
}
