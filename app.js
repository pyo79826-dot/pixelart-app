(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const canvas = $("pixelCanvas");
  const ctx = canvas.getContext("2d");

  const DEFAULT_PALETTE = [
    "#0B0D14", "#252A36", "#596176", "#EEF2FF", "#FFFFFF", "#63E6FF",
    "#4299FF", "#6767FF", "#9A7CFF", "#D66DFF", "#FF6DB2", "#FF637A",
    "#FF9B61", "#FFD166", "#B8F36B", "#4FE0A5", "#1BA784", "#6B4436"
  ];

  const TOOL_NAMES = {
    pencil: "PENCIL",
    eraser: "ERASER",
    fill: "FILL",
    eyedropper: "EYEDROPPER",
    line: "LINE",
    rect: "RECTANGLE",
    hotspot: "HOTSPOT"
  };

  const state = {
    name: "My Cursor",
    size: 32,
    zoom: 16,
    color: "#63E6FF",
    transparentInk: false,
    tool: "pencil",
    showGrid: true,
    mirrorX: false,
    mirrorY: false,
    pixels: [],
    hotspot: { x: 0, y: 0 },
    previewBg: "checker",
    recentColors: [],
    drawing: false,
    lastCell: null,
    dragStart: null,
    shapeBase: null,
    shapeErase: false,
    actionChanged: false,
    historyPushed: false,
    undo: [],
    redo: []
  };

  let installPrompt = null;
  let toastTimer = null;
  let saveTimer = null;

  function emptyPixels(size) {
    return new Array(size * size).fill(null);
  }

  function cloneSnapshot() {
    return {
      name: state.name,
      size: state.size,
      pixels: state.pixels.slice(),
      hotspot: { x: state.hotspot.x, y: state.hotspot.y }
    };
  }

  function applySnapshot(snapshot) {
    state.name = snapshot.name || state.name;
    state.size = snapshot.size;
    state.pixels = snapshot.pixels.slice();
    state.hotspot = { x: snapshot.hotspot.x, y: snapshot.hotspot.y };
    $("sizeSelect").value = String(state.size);
    $("projectNameInput").value = state.name;
    updateCanvasDimensions();
    render();
    persist();
  }

  function pushHistory() {
    state.undo.push(cloneSnapshot());
    if (state.undo.length > 100) state.undo.shift();
    state.redo.length = 0;
    updateUndoButtons();
  }

  function undo() {
    if (!state.undo.length) return;
    state.redo.push(cloneSnapshot());
    applySnapshot(state.undo.pop());
    updateUndoButtons();
  }

  function redo() {
    if (!state.redo.length) return;
    state.undo.push(cloneSnapshot());
    applySnapshot(state.redo.pop());
    updateUndoButtons();
  }

  function updateUndoButtons() {
    $("undoBtn").disabled = state.undo.length === 0;
    $("redoBtn").disabled = state.redo.length === 0;
  }

  function updateCanvasDimensions() {
    const side = state.size * state.zoom;
    canvas.width = side;
    canvas.height = side;
    canvas.style.width = side + "px";
    canvas.style.height = side + "px";
    $("canvasLabel").textContent = state.size + " × " + state.size;
    $("zoomValue").textContent = state.zoom + "×";
    $("hotspotLabel").textContent = state.hotspot.x + ", " + state.hotspot.y;
  }

  function drawCheckerCell(x, y, cell) {
    ctx.fillStyle = ((x + y) & 1) === 0 ? "#e8e9ed" : "#c7cad0";
    ctx.fillRect(x * cell, y * cell, cell, cell);
  }

  function render() {
    const cell = state.zoom;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < state.size; y++) {
      for (let x = 0; x < state.size; x++) {
        drawCheckerCell(x, y, cell);
        const value = state.pixels[y * state.size + x];
        if (value) {
          ctx.fillStyle = value;
          ctx.fillRect(x * cell, y * cell, cell, cell);
        }
      }
    }

    if (state.showGrid && cell >= 7) {
      ctx.beginPath();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(14,18,27,.24)";
      for (let i = 0; i <= state.size; i++) {
        const p = i * cell + .5;
        ctx.moveTo(p, 0);
        ctx.lineTo(p, canvas.height);
        ctx.moveTo(0, p);
        ctx.lineTo(canvas.width, p);
      }
      ctx.stroke();
    }

    drawHotspotOverlay();
    updateStats();
    updatePreviews();
  }

  function drawHotspotOverlay() {
    const cell = state.zoom;
    const x = state.hotspot.x * cell;
    const y = state.hotspot.y * cell;
    ctx.save();
    ctx.strokeStyle = "#FF4263";
    ctx.lineWidth = Math.max(1.5, cell * .1);
    ctx.beginPath();
    ctx.arc(x + cell / 2, y + cell / 2, Math.max(2.5, cell * .18), 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + cell / 2, y + 1);
    ctx.lineTo(x + cell / 2, y + cell - 1);
    ctx.moveTo(x + 1, y + cell / 2);
    ctx.lineTo(x + cell - 1, y + cell / 2);
    ctx.stroke();
    ctx.restore();
  }

  function updateStats() {
    const used = state.pixels.filter(Boolean);
    $("statsLabel").textContent = used.length + " px · " + new Set(used).size + " colors";
  }

  function renderRawCanvas(sizePx) {
    const out = document.createElement("canvas");
    out.width = sizePx;
    out.height = sizePx;
    const o = out.getContext("2d");
    o.imageSmoothingEnabled = false;

    const base = document.createElement("canvas");
    base.width = state.size;
    base.height = state.size;
    const b = base.getContext("2d");
    b.clearRect(0, 0, state.size, state.size);

    for (let y = 0; y < state.size; y++) {
      for (let x = 0; x < state.size; x++) {
        const value = state.pixels[y * state.size + x];
        if (value) {
          b.fillStyle = value;
          b.fillRect(x, y, 1, 1);
        }
      }
    }
    o.drawImage(base, 0, 0, sizePx, sizePx);
    return out;
  }

  function updatePreviews() {
    document.querySelectorAll(".preview-canvas").forEach((preview) => {
      const size = Number(preview.dataset.size);
      preview.width = size;
      preview.height = size;
      preview.style.width = size + "px";
      preview.style.height = size + "px";
      const pctx = preview.getContext("2d");
      pctx.imageSmoothingEnabled = false;
      pctx.clearRect(0, 0, size, size);
      pctx.drawImage(renderRawCanvas(state.size), 0, 0, size, size);

      const hx = Math.floor((state.hotspot.x / state.size) * size);
      const hy = Math.floor((state.hotspot.y / state.size) * size);
      pctx.fillStyle = "#ff4263";
      pctx.fillRect(Math.max(0, hx - 1), Math.max(0, hy - 1), 2, 2);
    });

    document.querySelectorAll(".preview-surface").forEach((surface) => {
      surface.classList.remove("light", "dark");
      if (state.previewBg !== "checker") surface.classList.add(state.previewBg);
    });

    const raw = renderRawCanvas(state.size);
    const url = raw.toDataURL("image/png");
    $("cursorPlayground").style.cursor =
      'url("' + url + '") ' + state.hotspot.x + " " + state.hotspot.y + ", crosshair";
  }

  function getCellFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * state.size);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * state.size);
    if (x < 0 || y < 0 || x >= state.size || y >= state.size) return null;
    return { x, y };
  }

  function setPixelRaw(x, y, value) {
    if (x < 0 || y < 0 || x >= state.size || y >= state.size) return false;
    const index = y * state.size + x;
    if (state.pixels[index] === value) return false;
    state.pixels[index] = value;
    return true;
  }

  function symmetricCells(x, y) {
    const cells = [[x, y]];
    if (state.mirrorX) cells.push([state.size - 1 - x, y]);
    if (state.mirrorY) cells.push([x, state.size - 1 - y]);
    if (state.mirrorX && state.mirrorY) cells.push([state.size - 1 - x, state.size - 1 - y]);

    const seen = new Set();
    return cells.filter(([cx, cy]) => {
      const key = cx + ":" + cy;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function setPixelWithMirror(x, y, value) {
    let changed = false;
    symmetricCells(x, y).forEach(([cx, cy]) => {
      if (setPixelRaw(cx, cy, value)) changed = true;
    });
    return changed;
  }

  function currentInk() {
    return state.transparentInk ? null : state.color;
  }

  function paintCell(cell, eraseOverride) {
    const erase = eraseOverride || state.tool === "eraser";
    const value = erase ? null : currentInk();
    if (setPixelWithMirror(cell.x, cell.y, value)) state.actionChanged = true;
  }

  function traceLine(from, to, callback) {
    let x0 = from.x;
    let y0 = from.y;
    const x1 = to.x;
    const y1 = to.y;
    const dx = Math.abs(x1 - x0);
    const sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0);
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;

    while (true) {
      callback(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  function drawLineCells(from, to, value) {
    traceLine(from, to, (x, y) => {
      if (setPixelWithMirror(x, y, value)) state.actionChanged = true;
    });
  }

  function drawRectCells(from, to, value) {
    const left = Math.min(from.x, to.x);
    const right = Math.max(from.x, to.x);
    const top = Math.min(from.y, to.y);
    const bottom = Math.max(from.y, to.y);

    for (let x = left; x <= right; x++) {
      if (setPixelWithMirror(x, top, value)) state.actionChanged = true;
      if (setPixelWithMirror(x, bottom, value)) state.actionChanged = true;
    }
    for (let y = top + 1; y < bottom; y++) {
      if (setPixelWithMirror(left, y, value)) state.actionChanged = true;
      if (setPixelWithMirror(right, y, value)) state.actionChanged = true;
    }
  }

  function floodFill(start, replacement) {
    const startIndex = start.y * state.size + start.x;
    const target = state.pixels[startIndex];
    if (target === replacement) return false;

    const stack = [start];
    const visited = new Uint8Array(state.size * state.size);
    let changed = false;

    while (stack.length) {
      const cell = stack.pop();
      const idx = cell.y * state.size + cell.x;
      if (visited[idx]) continue;
      visited[idx] = 1;
      if (state.pixels[idx] !== target) continue;

      state.pixels[idx] = replacement;
      changed = true;

      if (cell.x > 0) stack.push({ x: cell.x - 1, y: cell.y });
      if (cell.x < state.size - 1) stack.push({ x: cell.x + 1, y: cell.y });
      if (cell.y > 0) stack.push({ x: cell.x, y: cell.y - 1 });
      if (cell.y < state.size - 1) stack.push({ x: cell.x, y: cell.y + 1 });
    }
    return changed;
  }

  function pickColor(cell) {
    const value = state.pixels[cell.y * state.size + cell.x];
    if (!value) {
      state.transparentInk = true;
      syncColorUI();
      showToast("透明色を選択");
      return;
    }
    state.transparentInk = false;
    state.color = value;
    rememberColor(value);
    syncColorUI();
    showToast(value + " を取得");
  }

  function setHotspot(cell) {
    if (state.hotspot.x === cell.x && state.hotspot.y === cell.y) return false;
    state.hotspot = { x: cell.x, y: cell.y };
    $("hotspotLabel").textContent = cell.x + ", " + cell.y;
    return true;
  }

  function beginHistoryAction() {
    pushHistory();
    state.historyPushed = true;
    state.actionChanged = false;
  }

  function pointerDown(event) {
    if (event.button !== 0 && event.button !== 2) return;
    const cell = getCellFromEvent(event);
    if (!cell) return;

    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    state.drawing = true;
    state.lastCell = cell;
    state.dragStart = cell;
    state.shapeBase = null;
    state.shapeErase = event.button === 2;
    state.actionChanged = false;
    state.historyPushed = false;

    const eraseOverride = event.button === 2;

    if (state.tool === "pencil" || state.tool === "eraser") {
      beginHistoryAction();
      paintCell(cell, eraseOverride);
      render();
      return;
    }

    if (state.tool === "line" || state.tool === "rect") {
      beginHistoryAction();
      state.shapeBase = state.pixels.slice();
      renderShape(cell);
      return;
    }

    if (state.tool === "fill") {
      beginHistoryAction();
      state.actionChanged = floodFill(cell, eraseOverride ? null : currentInk());
      render();
      finishAction();
      return;
    }

    if (state.tool === "eyedropper") {
      pickColor(cell);
      state.drawing = false;
      return;
    }

    if (state.tool === "hotspot") {
      beginHistoryAction();
      state.actionChanged = setHotspot(cell);
      render();
      finishAction();
    }
  }

  function renderShape(cell) {
    if (!state.shapeBase || !state.dragStart) return;
    state.pixels = state.shapeBase.slice();
    state.actionChanged = false;
    const value = state.shapeErase ? null : currentInk();

    if (state.tool === "line") drawLineCells(state.dragStart, cell, value);
    if (state.tool === "rect") drawRectCells(state.dragStart, cell, value);
    render();
  }

  function pointerMove(event) {
    const cell = getCellFromEvent(event);
    $("coordLabel").textContent = cell ? cell.x + ", " + cell.y : "--, --";
    if (!state.drawing || !cell) return;

    const eraseOverride = (event.buttons & 2) === 2;
    if (state.tool === "pencil" || state.tool === "eraser") {
      if (!state.lastCell) state.lastCell = cell;
      traceLine(state.lastCell, cell, (x, y) => paintCell({ x, y }, eraseOverride));
      state.lastCell = cell;
      render();
      return;
    }

    if (state.tool === "line" || state.tool === "rect") renderShape(cell);
  }

  function finishAction() {
    if (state.historyPushed && !state.actionChanged) {
      state.undo.pop();
      updateUndoButtons();
    } else if (state.actionChanged) {
      if (!state.transparentInk) rememberColor(state.color);
      persist();
    }

    state.drawing = false;
    state.lastCell = null;
    state.dragStart = null;
    state.shapeBase = null;
    state.actionChanged = false;
    state.historyPushed = false;
  }

  function setTool(tool) {
    state.tool = tool;
    document.querySelectorAll(".tool").forEach((button) => {
      button.classList.toggle("active", button.dataset.tool === tool);
    });
    $("toolLabel").textContent = TOOL_NAMES[tool];
  }

  function normalizeHex(value) {
    const v = String(value || "").trim().toUpperCase();
    if (/^#[0-9A-F]{6}$/.test(v)) return v;
    if (/^[0-9A-F]{6}$/.test(v)) return "#" + v;
    return null;
  }

  function rememberColor(color) {
    const normalized = normalizeHex(color);
    if (!normalized) return;
    state.recentColors = [normalized, ...state.recentColors.filter((c) => c !== normalized)].slice(0, 6);
    renderRecentColors();
  }

  function syncColorUI() {
    $("colorPicker").value = state.color;
    $("hexInput").value = state.transparentInk ? "TRANSP." : state.color;

    document.querySelectorAll(".swatch").forEach((swatch) => {
      swatch.classList.toggle("selected", !state.transparentInk && swatch.dataset.color === state.color);
    });

    $("transparentBtn").style.outline = state.transparentInk ? "2px solid #ffffff" : "none";
  }

  function buildPalette() {
    const palette = $("palette");
    palette.innerHTML = "";

    DEFAULT_PALETTE.forEach((color) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "swatch";
      button.dataset.color = color;
      button.style.background = color;
      button.title = color;
      button.addEventListener("click", () => {
        state.color = color;
        state.transparentInk = false;
        rememberColor(color);
        syncColorUI();
      });
      palette.appendChild(button);
    });

    syncColorUI();
    renderRecentColors();
  }

  function renderRecentColors() {
    const wrap = $("recentColors");
    wrap.innerHTML = "";
    state.recentColors.forEach((color) => {
      const button = document.createElement("button");
      button.className = "recent-color";
      button.style.background = color;
      button.title = color;
      button.addEventListener("click", () => {
        state.color = color;
        state.transparentInk = false;
        syncColorUI();
      });
      wrap.appendChild(button);
    });
  }

  function resizeCanvas(newSize) {
    newSize = Number(newSize);
    if (newSize === state.size) return;

    pushHistory();
    const oldSize = state.size;
    const oldPixels = state.pixels.slice();
    state.size = newSize;
    state.pixels = emptyPixels(newSize);

    const copySize = Math.min(oldSize, newSize);
    for (let y = 0; y < copySize; y++) {
      for (let x = 0; x < copySize; x++) {
        state.pixels[y * newSize + x] = oldPixels[y * oldSize + x];
      }
    }

    state.hotspot.x = Math.min(state.hotspot.x, newSize - 1);
    state.hotspot.y = Math.min(state.hotspot.y, newSize - 1);
    updateCanvasDimensions();
    render();
    persist();
  }

  function transformPixels(mapper) {
    pushHistory();
    const next = emptyPixels(state.size);
    for (let y = 0; y < state.size; y++) {
      for (let x = 0; x < state.size; x++) {
        const value = state.pixels[y * state.size + x];
        if (!value) continue;
        const [nx, ny] = mapper(x, y);
        next[ny * state.size + nx] = value;
      }
    }
    state.pixels = next;
    render();
    persist();
  }

  function flipHorizontal() {
    transformPixels((x, y) => [state.size - 1 - x, y]);
    state.hotspot.x = state.size - 1 - state.hotspot.x;
    render();
    persist();
  }

  function flipVertical() {
    transformPixels((x, y) => [x, state.size - 1 - y]);
    state.hotspot.y = state.size - 1 - state.hotspot.y;
    render();
    persist();
  }

  function centerArtwork() {
    let minX = state.size, minY = state.size, maxX = -1, maxY = -1;
    for (let y = 0; y < state.size; y++) {
      for (let x = 0; x < state.size; x++) {
        if (!state.pixels[y * state.size + x]) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    if (maxX < 0) {
      showToast("中央に寄せる絵がありません");
      return;
    }

    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const targetX = Math.floor((state.size - width) / 2);
    const targetY = Math.floor((state.size - height) / 2);
    const dx = targetX - minX;
    const dy = targetY - minY;
    if (dx === 0 && dy === 0) {
      showToast("すでに中央です");
      return;
    }

    pushHistory();
    const next = emptyPixels(state.size);
    for (let y = 0; y < state.size; y++) {
      for (let x = 0; x < state.size; x++) {
        const value = state.pixels[y * state.size + x];
        if (!value) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < state.size && ny < state.size) {
          next[ny * state.size + nx] = value;
        }
      }
    }
    state.pixels = next;
    state.hotspot.x = Math.max(0, Math.min(state.size - 1, state.hotspot.x + dx));
    state.hotspot.y = Math.max(0, Math.min(state.size - 1, state.hotspot.y + dy));
    render();
    persist();
    showToast("絵を中央に寄せました");
  }

  function clearCanvas() {
    if (!state.pixels.some(Boolean)) return;
    if (!confirm("キャンバスを全消去しますか？")) return;
    pushHistory();
    state.pixels = emptyPixels(state.size);
    render();
    persist();
    showToast("キャンバスをクリアしました");
  }

  function newProject() {
    const hasWork = state.pixels.some(Boolean);
    if (hasWork && !confirm("新しいプロジェクトを作りますか？ 現在の絵は自動保存から置き換わります。")) return;
    pushHistory();
    state.name = "My Cursor";
    state.size = 32;
    state.pixels = emptyPixels(32);
    state.hotspot = { x: 0, y: 0 };
    state.mirrorX = false;
    state.mirrorY = false;
    $("projectNameInput").value = state.name;
    $("sizeSelect").value = "32";
    $("mirrorXBtn").classList.remove("active");
    $("mirrorYBtn").classList.remove("active");
    updateCanvasDimensions();
    render();
    persist();
    showToast("新しいキャンバスを作りました");
  }

  function sanitizeName(name) {
    const cleaned = String(name || "pixcursor")
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
    return cleaned || "pixcursor";
  }

  function downloadBlob(blob, filename) {
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportPng(scale) {
    const side = state.size * scale;
    const out = renderRawCanvas(side);
    out.toBlob((blob) => {
      if (!blob) return;
      const suffix = scale > 1 ? "-" + scale + "x" : "";
      downloadBlob(blob, sanitizeName(state.name) + "-" + state.size + "px" + suffix + ".png");
      showToast("PNG " + scale + "× を書き出しました");
    }, "image/png");
  }

  async function exportCur() {
    const raw = renderRawCanvas(state.size);
    const pngBlob = await new Promise((resolve) => raw.toBlob(resolve, "image/png"));
    if (!pngBlob) return;

    const png = new Uint8Array(await pngBlob.arrayBuffer());
    const headerSize = 22;
    const out = new Uint8Array(headerSize + png.length);
    const view = new DataView(out.buffer);

    view.setUint16(0, 0, true);
    view.setUint16(2, 2, true);
    view.setUint16(4, 1, true);
    out[6] = state.size >= 256 ? 0 : state.size;
    out[7] = state.size >= 256 ? 0 : state.size;
    out[8] = 0;
    out[9] = 0;
    view.setUint16(10, state.hotspot.x, true);
    view.setUint16(12, state.hotspot.y, true);
    view.setUint32(14, png.length, true);
    view.setUint32(18, headerSize, true);
    out.set(png, headerSize);

    downloadBlob(new Blob([out], { type: "application/octet-stream" }), sanitizeName(state.name) + ".cur");
    showToast("Windowsカーソル (.cur) を書き出しました");
  }


  function projectFingerprint() {
    let hash = 2166136261;
    const source = state.size + "|" + state.hotspot.x + "," + state.hotspot.y + "|" +
      state.pixels.map((v) => v || "-").join(",");
    for (let i = 0; i < source.length; i++) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();
  }

  function getSparsePixels() {
    const pixels = [];
    for (let y = 0; y < state.size; y++) {
      for (let x = 0; x < state.size; x++) {
        const color = state.pixels[y * state.size + x];
        if (color) pixels.push({ x, y, color });
      }
    }
    return pixels;
  }

  function buildChatGPTBridgePackage() {
    const sparsePixels = getSparsePixels();
    const usedColors = [...new Set(sparsePixels.map((p) => p.color))];

    return {
      format: "pixcursor-chat-bridge-v1",
      app: "PixCursor",
      project: {
        name: state.name,
        size: state.size,
        hotspot: { x: state.hotspot.x, y: state.hotspot.y },
        fingerprint: projectFingerprint(),
        pixels: sparsePixels,
        palette: usedColors,
        stats: {
          paintedPixels: sparsePixels.length,
          colorCount: usedColors.length
        }
      },
      instructions_for_chatgpt: {
        purpose: "Edit this PixCursor project according to the user's request.",
        coordinate_system: "x=0 is left, y=0 is top. Coordinates are integer pixels.",
        transparency: "Use null as color to erase a pixel.",
        output_rule: "Return exactly one JSON object using the pixcursor-ai-edit-v1 schema. No markdown is required.",
        preferred_mode: "Use mode='patch' for small edits. Use mode='replace' when redesigning most of the cursor.",
        schema: {
          format: "pixcursor-ai-edit-v1",
          baseFingerprint: "Copy project.fingerprint from this package.",
          baseSize: "Copy project.size from this package.",
          mode: "patch or replace",
          name: "optional new project name",
          hotspot: { x: "optional integer", y: "optional integer" },
          ops: [
            { x: "integer", y: "integer", color: "#RRGGBB or null" }
          ],
          summary: "optional short Japanese summary"
        }
      }
    };
  }

  function buildChatGPTClipboardText() {
    const pkg = buildChatGPTBridgePackage();
    return [
      "PixCursorの作品データです。",
      "このデータを読み取り、私がこのあと書く要望に合わせて編集してください。",
      "返答はデータ内の instructions_for_chatgpt にある pixcursor-ai-edit-v1 形式のJSONにしてください。",
      "",
      JSON.stringify(pkg)
    ].join("\n");
  }

  async function copyForChatGPT() {
    const text = buildChatGPTClipboardText();
    try {
      await navigator.clipboard.writeText(text);
      showToast("ChatGPT用データをコピーしました");
      setBridgeStatus("ChatGPTに貼り付けできます", false);
    } catch (error) {
      $("aiEditPaste").value = text;
      $("aiEditPaste").focus();
      $("aiEditPaste").select();
      showToast("下の欄にデータを入れました。コピーしてください");
    }
  }

  function downloadChatGPTPackage() {
    const payload = buildChatGPTBridgePackage();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    downloadBlob(blob, sanitizeName(state.name) + ".pixchat.json");
    showToast("ChatGPT用ファイルを保存しました");
  }

  function extractJsonObject(text) {
    const raw = String(text || "").trim();
    if (!raw) throw new Error("empty");

    try {
      return JSON.parse(raw);
    } catch (error) {
      const fenced = raw.match(/\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`/i);
      if (fenced) return JSON.parse(fenced[1].trim());

      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
      throw error;
    }
  }

  function validateAiEdit(edit) {
    if (!edit || edit.format !== "pixcursor-ai-edit-v1") {
      throw new Error("format");
    }
    if (!["patch", "replace"].includes(edit.mode)) {
      throw new Error("mode");
    }
    if (Number(edit.baseSize) !== state.size) {
      throw new Error("size");
    }
    if (!Array.isArray(edit.ops)) {
      throw new Error("ops");
    }
    if (edit.ops.length > state.size * state.size * 2) {
      throw new Error("too_many_ops");
    }

    const normalizedOps = edit.ops.map((op) => {
      const x = Number(op && op.x);
      const y = Number(op && op.y);
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= state.size || y >= state.size) {
        throw new Error("coordinate");
      }
      const color = op.color === null ? null : normalizeHex(op.color);
      if (op.color !== null && !color) throw new Error("color");
      return { x, y, color };
    });

    return { ...edit, ops: normalizedOps };
  }

  function applyAiEditObject(rawEdit) {
    const edit = validateAiEdit(rawEdit);
    const currentFingerprint = projectFingerprint();

    if (edit.baseFingerprint && edit.baseFingerprint !== currentFingerprint) {
      const proceed = confirm(
        "このAI編集は、現在のキャンバスとは別の状態を元に作られています。\\n" +
        "それでも反映しますか？"
      );
      if (!proceed) return;
    }

    pushHistory();

    if (edit.mode === "replace") {
      state.pixels = emptyPixels(state.size);
    }

    edit.ops.forEach((op) => {
      state.pixels[op.y * state.size + op.x] = op.color;
    });

    if (edit.hotspot && Number.isInteger(Number(edit.hotspot.x)) && Number.isInteger(Number(edit.hotspot.y))) {
      state.hotspot = {
        x: Math.max(0, Math.min(state.size - 1, Number(edit.hotspot.x))),
        y: Math.max(0, Math.min(state.size - 1, Number(edit.hotspot.y)))
      };
    }

    if (typeof edit.name === "string" && edit.name.trim()) {
      state.name = edit.name.trim().slice(0, 40);
      $("projectNameInput").value = state.name;
    }

    render();
    persist();
    $("aiEditPaste").value = "";
    const summary = typeof edit.summary === "string" && edit.summary.trim()
      ? edit.summary.trim()
      : edit.ops.length + "ピクセルのAI編集を反映しました";
    showToast("AI編集を反映しました");
    setBridgeStatus(summary, false);
  }

  function applyAiEditFromText(text) {
    try {
      const parsed = extractJsonObject(text);
      applyAiEditObject(parsed);
    } catch (error) {
      const messages = {
        empty: "編集データが空です",
        format: "PixCursor用のAI編集データではありません",
        mode: "AI編集のmodeが不正です",
        size: "キャンバスサイズが現在の作品と違います",
        ops: "AI編集にピクセル操作がありません",
        coordinate: "範囲外のピクセル座標があります",
        color: "不正なカラーコードがあります",
        too_many_ops: "編集データが大きすぎます"
      };
      showToast(messages[error.message] || "AI編集データを読み取れませんでした");
      setBridgeStatus("編集データを確認してください", true);
    }
  }

  async function importAiEditFile(file) {
    if (!file) return;
    try {
      applyAiEditFromText(await file.text());
    } catch (error) {
      showToast("編集ファイルを開けませんでした");
    }
  }

  function setBridgeStatus(message, warn) {
    const el = $("bridgeStatus");
    if (!el) return;
    el.classList.toggle("warn", Boolean(warn));
    const textEl = el.querySelector("span:last-child");
    if (textEl) textEl.textContent = message;
  }

  function exportProject() {
    const payload = {
      format: "pixcursor-project",
      version: 2,
      name: state.name,
      size: state.size,
      pixels: state.pixels,
      hotspot: state.hotspot,
      color: state.color,
      recentColors: state.recentColors
    };
    downloadBlob(
      new Blob([JSON.stringify(payload)], { type: "application/json" }),
      sanitizeName(state.name) + ".pixcursor.json"
    );
    showToast("プロジェクトを保存しました");
  }

  async function importProject(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || ![16,24,32,48,64].includes(parsed.size)) throw new Error("size");
      if (!Array.isArray(parsed.pixels) || parsed.pixels.length !== parsed.size * parsed.size) throw new Error("pixels");

      pushHistory();
      state.name = String(parsed.name || "Imported Cursor").slice(0, 40);
      state.size = parsed.size;
      state.pixels = parsed.pixels.map((v) => normalizeHex(v) || null);
      state.hotspot = {
        x: Math.max(0, Math.min(state.size - 1, Number(parsed.hotspot?.x) || 0)),
        y: Math.max(0, Math.min(state.size - 1, Number(parsed.hotspot?.y) || 0))
      };
      state.color = normalizeHex(parsed.color) || state.color;
      state.recentColors = Array.isArray(parsed.recentColors)
        ? parsed.recentColors.map(normalizeHex).filter(Boolean).slice(0, 6)
        : state.recentColors;

      $("projectNameInput").value = state.name;
      $("sizeSelect").value = String(state.size);
      updateCanvasDimensions();
      syncColorUI();
      renderRecentColors();
      render();
      persist();
      showToast("プロジェクトを開きました");
    } catch (error) {
      showToast("このプロジェクトファイルは開けません");
    }
  }

  function importImage(file) {
    if (!file) return;
    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = () => {
      pushHistory();
      const temp = document.createElement("canvas");
      temp.width = state.size;
      temp.height = state.size;
      const tctx = temp.getContext("2d");
      tctx.imageSmoothingEnabled = false;
      tctx.clearRect(0, 0, state.size, state.size);

      const ratio = Math.min(state.size / image.width, state.size / image.height);
      const w = Math.max(1, Math.round(image.width * ratio));
      const h = Math.max(1, Math.round(image.height * ratio));
      const dx = Math.floor((state.size - w) / 2);
      const dy = Math.floor((state.size - h) / 2);
      tctx.drawImage(image, dx, dy, w, h);

      const data = tctx.getImageData(0, 0, state.size, state.size).data;
      const next = emptyPixels(state.size);
      for (let i = 0; i < state.size * state.size; i++) {
        const r = data[i * 4];
        const g = data[i * 4 + 1];
        const b = data[i * 4 + 2];
        const a = data[i * 4 + 3];
        if (a < 40) continue;
        next[i] = "#" + [r,g,b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
      }

      state.pixels = next;
      URL.revokeObjectURL(url);
      render();
      persist();
      showToast("画像をドット化して読み込みました");
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      showToast("画像を読み込めませんでした");
    };

    image.src = url;
  }

  function markSaving() {
    const el = $("saveState");
    el.classList.add("saving");
    el.lastChild.textContent = "SAVING";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      el.classList.remove("saving");
      el.lastChild.textContent = "AUTO SAVED";
    }, 450);
  }

  function persist() {
    const payload = {
      version: 2,
      name: state.name,
      size: state.size,
      pixels: state.pixels,
      hotspot: state.hotspot,
      color: state.color,
      recentColors: state.recentColors
    };
    localStorage.setItem("pixelCursorLabProject", JSON.stringify(payload));
    markSaving();
    if ($("bridgeStatus")) setBridgeStatus("現在の作品と同期済み", false);
  }

  function loadPersisted() {
    try {
      const raw = localStorage.getItem("pixelCursorLabProject");
      if (!raw) return false;
      const saved = JSON.parse(raw);
      if (![16,24,32,48,64].includes(saved.size)) return false;
      if (!Array.isArray(saved.pixels) || saved.pixels.length !== saved.size * saved.size) return false;

      state.name = String(saved.name || "My Cursor").slice(0, 40);
      state.size = saved.size;
      state.pixels = saved.pixels;
      state.hotspot = saved.hotspot || { x: 0, y: 0 };
      state.color = normalizeHex(saved.color) || state.color;
      state.recentColors = Array.isArray(saved.recentColors)
        ? saved.recentColors.map(normalizeHex).filter(Boolean).slice(0, 6)
        : [];

      $("sizeSelect").value = String(state.size);
      $("projectNameInput").value = state.name;
      return true;
    } catch (error) {
      return false;
    }
  }

  function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
  }

  function addChat(role, text) {
    const wrap = document.createElement("div");
    wrap.className = "message " + role;
    const p = document.createElement("p");
    p.textContent = text;
    wrap.appendChild(p);
    $("chatLog").appendChild(wrap);
    $("chatLog").scrollTop = $("chatLog").scrollHeight;
  }

  function analyzeArt() {
    const used = state.pixels.filter(Boolean);
    if (!used.length) {
      return "まだ何も描かれていないよ。まず大きなシルエットを1色で作って、16pxプレビューで形が読めるか確認してみよう。";
    }

    const colors = new Set(used);
    let minX = state.size, minY = state.size, maxX = -1, maxY = -1;
    let edgePixels = 0;
    let isolated = 0;

    for (let y = 0; y < state.size; y++) {
      for (let x = 0; x < state.size; x++) {
        if (!state.pixels[y * state.size + x]) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        if (x === 0 || y === 0 || x === state.size - 1 || y === state.size - 1) edgePixels++;

        const neighbors = [
          x > 0 && state.pixels[y * state.size + x - 1],
          x < state.size - 1 && state.pixels[y * state.size + x + 1],
          y > 0 && state.pixels[(y - 1) * state.size + x],
          y < state.size - 1 && state.pixels[(y + 1) * state.size + x]
        ];
        if (!neighbors.some(Boolean)) isolated++;
      }
    }

    const fillRate = Math.round((used.length / (state.size * state.size)) * 100);
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const notes = [];

    notes.push("使用色 " + colors.size + "色、" + used.length + "px、占有率 " + fillRate + "%、範囲 " + width + "×" + height + "px。");

    if (colors.size > 10) notes.push("小さいカーソルとしては色数が多め。5〜8色くらいに整理すると読みやすくなりやすいよ。");
    else if (colors.size <= 2) notes.push("色数はかなりシンプル。輪郭とハイライトを1色ずつ足す余地がありそう。");
    else notes.push("色数は扱いやすい範囲。");

    if (edgePixels > 0) notes.push("外周に触れているピクセルがあるので、必要なら1px余白を作ると安全。");
    else notes.push("外周には余白がある。");

    if (isolated >= 3) notes.push("孤立した1pxが " + isolated + " 個あるので、意図しないノイズがないか確認してみて。");

    const hs = state.pixels[state.hotspot.y * state.size + state.hotspot.x];
    if (!hs) notes.push("クリック位置は透明部分。先端や中心など、実際にクリックさせたい位置か確認してね。");

    return notes.join(" ");
  }

  function assistantReply(text) {
    const q = text.toLowerCase();

    if (q.includes("診断") || q.includes("チェック") || q.includes("どう")) return analyzeArt();
    if (q.includes("輪郭")) return "輪郭は1px幅を基本にして、外側を暗色・内側を明色にすると小さくしても形が残りやすいよ。曲線は 1→1→2px のように階段のリズムを揃えるときれい。";
    if (q.includes("色") || q.includes("カラー")) return "32px前後なら、基準色・暗い輪郭・影・ハイライトの4〜6色くらいから始めると調整しやすいよ。";
    if (q.includes("小さ") || q.includes("見やす") || q.includes("見え")) return "まず16pxプレビューを見るのがおすすめ。重要な形は2〜3pxの塊を残し、細い飾りは1pxでも途切れないようにすると読みやすいよ。";
    if (q.includes("透明")) return "背景は完全透明のままでOK。輪郭の外側に中途半端な半透明を置かない方が、Windows上ではシャープに見えやすいよ。";
    if (q.includes("カーソル") || q.includes("クリック")) return "「クリック位置」ツールで赤いマークを操作の基準点に置いてね。矢印なら先端、照準なら中心が基本。";
    if (q.includes("ドット")) return "アンチエイリアスを使わず、斜線の階段幅を揃えるとドット感が強くなるよ。左右対称ならMIRROR DRAWも便利。";
    if (q.includes("影") || q.includes("立体")) return "光源を左上など1方向に固定して、反対側に1段暗い色を置くと少ない色数でも立体感が出るよ。";

    return "カーソルは『小さくしたときに形が一瞬で読めるか』が大事。まず16pxプレビューで確認して、必要なら「今の絵を診断」を押してみて。";
  }

  function handleAssistantSubmit(text) {
    const value = String(text || "").trim();
    if (!value) return;
    addChat("user", value);
    setTimeout(() => addChat("assistant", assistantReply(value)), 150);
  }

  document.querySelectorAll(".tool").forEach((button) => {
    button.addEventListener("click", () => setTool(button.dataset.tool));
  });

  $("colorPicker").addEventListener("input", () => {
    state.color = $("colorPicker").value.toUpperCase();
    state.transparentInk = false;
    rememberColor(state.color);
    syncColorUI();
  });

  $("hexInput").addEventListener("change", () => {
    const color = normalizeHex($("hexInput").value);
    if (!color) {
      syncColorUI();
      return;
    }
    state.color = color;
    state.transparentInk = false;
    rememberColor(color);
    syncColorUI();
  });

  $("transparentBtn").addEventListener("click", () => {
    state.transparentInk = true;
    syncColorUI();
  });

  $("sizeSelect").addEventListener("change", () => resizeCanvas($("sizeSelect").value));

  $("zoomRange").addEventListener("input", () => {
    state.zoom = Number($("zoomRange").value);
    updateCanvasDimensions();
    render();
  });

  $("gridToggle").addEventListener("change", () => {
    state.showGrid = $("gridToggle").checked;
    render();
  });

  $("mirrorXBtn").addEventListener("click", () => {
    state.mirrorX = !state.mirrorX;
    $("mirrorXBtn").classList.toggle("active", state.mirrorX);
  });

  $("mirrorYBtn").addEventListener("click", () => {
    state.mirrorY = !state.mirrorY;
    $("mirrorYBtn").classList.toggle("active", state.mirrorY);
  });

  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", finishAction);
  canvas.addEventListener("pointercancel", finishAction);
  canvas.addEventListener("pointerleave", () => { $("coordLabel").textContent = "--, --"; });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  $("undoBtn").addEventListener("click", undo);
  $("redoBtn").addEventListener("click", redo);
  $("newBtn").addEventListener("click", newProject);
  $("clearBtn").addEventListener("click", clearCanvas);
  $("flipHBtn").addEventListener("click", flipHorizontal);
  $("flipVBtn").addEventListener("click", flipVertical);
  $("centerBtn").addEventListener("click", centerArtwork);
  $("exportCurBtn").addEventListener("click", exportCur);
  $("exportCurPanelBtn").addEventListener("click", exportCur);
  $("saveProjectBtn").addEventListener("click", exportProject);

  $("copyChatGPTBtn").addEventListener("click", copyForChatGPT);
  $("downloadChatGPTBtn").addEventListener("click", downloadChatGPTPackage);
  $("applyAiEditBtn").addEventListener("click", () => applyAiEditFromText($("aiEditPaste").value));
  $("aiEditFileInput").addEventListener("change", () => {
    importAiEditFile($("aiEditFileInput").files && $("aiEditFileInput").files[0]);
    $("aiEditFileInput").value = "";
  });

  document.querySelectorAll("[data-png-scale]").forEach((button) => {
    button.addEventListener("click", () => exportPng(Number(button.dataset.pngScale)));
  });

  $("importInput").addEventListener("change", () => {
    importImage($("importInput").files && $("importInput").files[0]);
    $("importInput").value = "";
  });

  $("openProjectInput").addEventListener("change", () => {
    importProject($("openProjectInput").files && $("openProjectInput").files[0]);
    $("openProjectInput").value = "";
  });

  $("projectNameInput").addEventListener("input", () => {
    state.name = $("projectNameInput").value.slice(0, 40);
    persist();
  });

  $("previewBgGroup").querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.previewBg = button.dataset.bg;
      $("previewBgGroup").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === button));
      updatePreviews();
    });
  });

  $("diagnoseBtn").addEventListener("click", () => addChat("assistant", analyzeArt()));

  document.querySelectorAll("[data-prompt]").forEach((button) => {
    button.addEventListener("click", () => handleAssistantSubmit(button.dataset.prompt));
  });

  $("assistantForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const text = $("assistantText").value;
    $("assistantText").value = "";
    handleAssistantSubmit(text);
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    $("installBtn").hidden = false;
  });

  $("installBtn").addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    $("installBtn").hidden = true;
  });

  window.addEventListener("appinstalled", () => {
    $("installBtn").hidden = true;
    showToast("PixCursorをインストールしました");
  });

  document.addEventListener("keydown", (event) => {
    if (event.target && /input|select|textarea/i.test(event.target.tagName)) return;
    const key = event.key.toLowerCase();

    if ((event.ctrlKey || event.metaKey) && key === "z") {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === "y") {
      event.preventDefault();
      redo();
      return;
    }

    if (key === "b") setTool("pencil");
    if (key === "e") setTool("eraser");
    if (key === "f") setTool("fill");
    if (key === "i") setTool("eyedropper");
    if (key === "l") setTool("line");
    if (key === "r") setTool("rect");
    if (key === "h") setTool("hotspot");
  });

  loadPersisted();
  if (!state.pixels.length) state.pixels = emptyPixels(state.size);
  buildPalette();
  updateCanvasDimensions();
  updateUndoButtons();
  render();

  requestAnimationFrame(() => {
    const stage = $("canvasStage");
    stage.scrollLeft = Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2);
    stage.scrollTop = Math.max(0, (stage.scrollHeight - stage.clientHeight) / 2);
  });
})();