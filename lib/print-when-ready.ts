/**
 * Auto-print bootstrap shared by every Template A print/PDF surface — the
 * /admin/cert-pdf route (React renderer) and the standalone HTML documents in
 * professional-scaffold-certificate-html.ts (bulk ZIP renderer). One copy, so
 * the two paths can never drift into producing different PDFs.
 *
 * Replaces a fixed `setTimeout(print, 400)`. That delay was the reason the
 * Director signature and the company stamp could be missing from a real
 * downloaded PDF: `window.print()` snapshots whatever is painted at the
 * instant it is called, and 400ms is a guess, not a guarantee — a cold cache,
 * a slow disk or a font swap pushes asset paint past it and the print snapshot
 * is taken without them. This waits on the actual signals instead:
 *
 *   1. document.fonts.ready   — no reflow/FOUT mid-snapshot
 *   2. every <img>            — complete && naturalWidth > 0, then decode()
 *   3. two animation frames   — decode() resolves one paint before the
 *                               decoded pixels are actually on screen
 *
 * The QR code deliberately has no step: it is inline <svg> emitted in the
 * server-rendered HTML, so it exists at parse time and has nothing to await.
 *
 * CAP_MS is a ceiling, not the mechanism — without it a single wedged asset
 * (a request that neither loads nor errors) would leave the operator on a page
 * that silently never opens the print dialog. Reaching it means an asset is
 * broken; the dialog still opens so the failure is visible rather than silent.
 * The cap deliberately spans the `load` event too, not just the work after it:
 * gating the timer behind `load` (as the delay it replaces did) means a stalled
 * subresource stops the timer from ever starting. Verified against a
 * 25KB/s-throttled run, where the old shape hung past 30s.
 *
 * Written as ES5-compatible source in a plain string because it is injected
 * both via dangerouslySetInnerHTML and into standalone .html files that are
 * downloaded and opened directly from disk.
 */
export const PRINT_WHEN_READY_SCRIPT = `(function(){
  if (new URLSearchParams(window.location.search).has('preview')) return;
  var CAP_MS = 15000;
  function settled(p){ return p.then(function(){}, function(){}); }
  function imageReady(img){
    var loaded = (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0)
      ? Promise.resolve()
      : new Promise(function(resolve){
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
        });
    return loaded.then(function(){ return img.decode ? settled(img.decode()) : undefined; });
  }
  function loaded(){
    return document.readyState === 'complete'
      ? Promise.resolve()
      : new Promise(function(resolve){ window.addEventListener('load', resolve, { once: true }); });
  }
  function fontsReady(attemptsLeft){
    if (!document.fonts) return Promise.resolve();
    return settled(document.fonts.ready).then(function(){
      // document.fonts.ready resolves for the batch that was in flight; layout
      // performed while images were decoding can start a NEW batch, which
      // flips status back to 'loading'. Re-await until it settles, or give up
      // and let CAP_MS handle it.
      if (document.fonts.status === 'loaded' || attemptsLeft <= 0) return;
      return fontsReady(attemptsLeft - 1);
    });
  }
  function ready(){
    return loaded().then(function(){
      var waits = [];
      Array.prototype.forEach.call(document.images, function(img){ waits.push(imageReady(img)); });
      // Images first: their decode drives the layout that can trigger the
      // second font batch described above.
      return Promise.all(waits).then(function(){ return fontsReady(5); });
    });
  }
  Promise.race([
    ready(),
    new Promise(function(resolve){ setTimeout(resolve, CAP_MS); })
  ]).then(function(){
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){
        try { window.print(); } catch (e) {}
      });
    });
  });
})();`;
