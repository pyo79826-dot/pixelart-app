(() => {
  "use strict";

  const canvas = document.getElementById("pixelCanvas");
  const ctx = canvas.getContext("2d");
  const canvasStage = document.getElementById("canvasStage");
  const colorPicker = document.getElementById("colorPicker");
  const hexInput = document.getElementById("hexInput");
  const paletteEl = document.getElementById("palette");
  const sizeSelect = document.getElementById("sizeSelect");
  const zoomRange = document.getElementById("zoomRange");
  const zoomValue = document.getElementById("zoomValue");
  const gridToggle = document.getElementById("gridToggle");
  const toolLabel = document.getElementById("toolLabel");
  const canvasLabel = document.getElementById("canvasLabel");
  const coordLabel = document.getElementById("coordLabel");
  const hotspotLabel = document.getElementById("hotspotLabel");
  const cursorPlayground = document.getElementById("cursorPlayground");
  const toast = document.getElementById("toast");
  const importInput = document.getElementById("importInput");
  const chatLog = document.getElementById("chatLog");
  const assistantText = document.getElementById("assistantText");

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
    hotspot: "HOTSPOT"
  };

  const state = {
    size: 32,
    zoom: 16,
    color: "#63E6FF",
    transparentInk: false,
    tool: "pencil",
    showGrid: true,
    pixels: [],
    hotspot: { x: 0, y: 0 },
    drawing: false,
    lastCell: null,
    actionChanged: false,
    undo: [],
    redo: []
  };

  function emptyPixels(size) {
    return new Array(size * size).fill(null);
  }

  function cloneSnapshot() {
    return {
      size: state.size,
      pixels: state.pixels.slice(),
      hotspot: { x: state.hotspot.x, y: state.hotspot.y }
    };
  }

  function applySnapshot(snapshot) {
    state.size = snapshot.size;
    state.pixels = snapshot.pixels.slice();
    state.hotspot = { x: snapshot.hotspot.x, y: snapshot.hotspot.y };
    sizeSelect.value = String(state.size);
    updateCanvasDimensions();
    render();
    persist();
  }

  function pushHistory() {
    state.undo.push(cloneSnapshot());
    if (state.undo.length > 80) state.undo.shift();
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
    document.getElementById("undoBtn").disabled = state.undo.length === 0;
    document.getElementById("redoBtn").disabled = state.redo.length === 0;
  }

  function updateCanvasDimensions() {
    const side = state.size * state.zoom;
    canvas.width = side;
    canvas.height = side;
    canvas.style.width = side + "px";
    canvas.style.height = side + "px";
    canvasLabel.textContent = state.size + " × " + state.size;
    zoomValue.textContent = state.zoom + "×";
    hotspotLabel.textContent = state.hotspot.x + ", " + state.hotspot.y;
  }

  function drawCheckerCell(x, y, cell) {
    const light = ((x + y) & 1) === 0;
    ctx.fillStyle = light ? "#e8e9ed" : "#c7cad0";
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
    updatePreviews();
  }

  function drawHotspotOverlay() {
    const cell = state.zoom;
    const x = state.hotspot.x * cell;
    const y = state.hotspot.y * cell;
    ctx.save();
    ctx.strokeStyle = "#FF4263";
    ctx.fillStyle = "#FF4263";
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
    const previews = document.querySelectorAll(".preview-canvas");
    previews.forEach(function (preview) {
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

    const raw = renderRawCanvas(state.size);
    const url = raw.toDataURL("image/png");
    cursorPlayground.style.cursor =
      'url("' + url + '") ' + state.hotspot.x + " " + state.hotspot.y + ", crosshair";
  }

  function getCellFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * state.size);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * state.size);
    if (x < 0 || y < 0 || x >= state.size || y >= state.size) return null;
    return { x: x, y: y };
  }

  function setPixel(x, y, value) {
    const index = y * state.size + x;
    if (state.pixels[index] === value) return false;
    state.pixels[index] = value;
    return true;
  }

  function currentInk() {
    return state.transparentInk ? null : state.color;
  }

  function paintCell(cell, eraseOverride) {
    const erase = eraseOverride || state.tool === "eraser";
    const value = erase ? null : currentInk();
    if (setPixel(cell.x, cell.y, value)) state.actionChanged = true;
  }

  function drawLineCells(from, to, eraseOverride) {
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
      paintCell({ x: x0, y: y0 }, eraseOverride);
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
    syncColorUI();
    showToast(value + " を取得");
  }

  function setHotspot(cell) {
    if (state.hotspot.x === cell.x && state.hotspot.y === cell.y) return false;
    state.hotspot = { x: cell.x, y: cell.y };
    hotspotLabel.textContent = cell.x + ", " + cell.y;
    return true;
  }

  function pointerDown(event) {
    if (event.button !== 0 && event.button !== 2) return;
    const cell = getCellFromEvent(event);
    if (!cell) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);

    state.drawing = true;
    state.lastCell = cell;
    state.actionChanged = false;
    const eraseOverride = event.button === 2;

    if (state.tool === "pencil" || state.tool === "eraser" || eraseOverride) {
      pushHistory();
      paintCell(cell, eraseOverride);
      render();
      return;
    }

    if (state.tool === "fill") {
      pushHistory();
      state.actionChanged = floodFill(cell, currentInk());
      if (!state.actionChanged) state.undo.pop();
      render();
      updateUndoButtons();
      finishAction();
      return;
    }

    if (state.tool === "eyedropper") {
      pickColor(cell);
      state.drawing = false;
      return;
    }

    if (state.tool === "hotspot") {
      pushHistory();
      state.actionChanged = setHotspot(cell);
      if (!state.actionChanged) state.undo.pop();
      render();
      updateUndoButtons();
      finishAction();
    }
  }

  function pointerMove(event) {
    const cell = getCellFromEvent(event);
    coordLabel.textContent = cell ? cell.x + ", " + cell.y : "--, --";
    if (!state.drawing || !cell) return;

    const eraseOverride = (event.buttons & 2) === 2;
    if (state.tool === "pencil" || state.tool === "eraser" || eraseOverride) {
      if (!state.lastCell) state.lastCell = cell;
      drawLineCells(state.lastCell, cell, eraseOverride);
      state.lastCell = cell;
      render();
    }
  }

  function finishAction() {
    if (state.actionChanged) persist();
    state.drawing = false;
    state.lastCell = null;
    state.actionChanged = false;
  }

  function setTool(tool) {
    state.tool = tool;
    document.querySelectorAll(".tool").forEach(function (button) {
      button.classList.toggle("active", button.dataset.tool === tool);
    });
    toolLabel.textContent = TOOL_NAMES[tool];
  }

  function normalizeHex(value) {
    let v = String(value || "").trim().toUpperCase();
    if (/^#[0-9A-F]{6}$/.test(v)) return v;
    if (/^[0-9A-F]{6}$/.test(v)) return "#" + v;
    return null;
  }

  function syncColorUI() {
    colorPicker.value = state.color;
    hexInput.value = state.transparentInk ? "TRANSP." : state.color;
    document.querySelectorAll(".swatch").forEach(function (swatch) {
      swatch.classList.toggle("selected", !state.transparentInk && swatch.dataset.color === state.color);
    });
    document.getElementById("transparentBtn").style.outline =
      state.transparentInk ? "2px solid #ffffff" : "none";
  }

  function buildPalette() {
    paletteEl.innerHTML = "";
    DEFAULT_PALETTE.forEach(function (color) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "swatch";
      button.dataset.color = color;
      button.style.background = color;
      button.title = color;
      button.addEventListener("click", function () {
        state.color = color;
        state.transparentInk = false;
        syncColorUI();
      });
      paletteEl.appendChild(button);
    });
    syncColorUI();
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

  function clearCanvas() {
    if (!state.pixels.some(Boolean)) return;
    pushHistory();
    state.pixels = emptyPixels(state.size);
    render();
    persist();
    showToast("キャンバスをクリアしました");
  }

  function downloadBlob(blob, filename) {
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportPng(scale) {
    const side = state.size * scale;
    const out = renderRawCanvas(side);
    out.toBlob(function (blob) {
      if (!blob) return;
      downloadBlob(blob, "pixel-cursor-" + state.size + "x" + state.size + (scale > 1 ? "-x" + scale : "") + ".png");
      showToast("PNGを書き出しました");
    }, "image/png");
  }

  async function exportCur() {
    const raw = renderRawCanvas(state.size);
    const pngBlob = await new Promise(function (resolve) {
      raw.toBlob(resolve, "image/png");
    });
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

    downloadBlob(new Blob([out], { type: "application/octet-stream" }), "pixel-cursor.cur");
    showToast("Windowsカーソル (.cur) を書き出しました");
  }

  function importImage(file) {
    if (!file) return;
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = function () {
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
        next[i] = "#" + [r, g, b].map(function (v) {
          return v.toString(16).padStart(2, "0");
        }).join("").toUpperCase();
      }
      state.pixels = next;
      URL.revokeObjectURL(url);
      render();
      persist();
      showToast("画像をドット化して読み込みました");
    };
    image.onerror = function () {
      URL.revokeObjectURL(url);
      showToast("画像を読み込めませんでした");
    };
    image.src = url;
  }

  function persist() {
    const payload = {
      size: state.size,
      pixels: state.pixels,
      hotspot: state.hotspot,
      color: state.color
    };
    localStorage.setItem("pixelCursorLabProject", JSON.stringify(payload));
  }

  function loadPersisted() {
    try {
      const raw = localStorage.getItem("pixelCursorLabProject");
      if (!raw) return false;
      const saved = JSON.parse(raw);
      if (![16, 24, 32, 48, 64].includes(saved.size)) return false;
      if (!Array.isArray(saved.pixels) || saved.pixels.length !== saved.size * saved.size) return false;
      state.size = saved.size;
      state.pixels = saved.pixels;
      state.hotspot = saved.hotspot || { x: 0, y: 0 };
      state.color = normalizeHex(saved.color) || state.color;
      sizeSelect.value = String(state.size);
      return true;
    } catch (error) {
      return false;
    }
  }

  let toastTimer = null;
  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove("show");
    }, 1800);
  }

  function addChat(role, text) {
    const wrap = document.createElement("div");
    wrap.className = "message " + role;
    const p = document.createElement("p");
    p.textContent = text;
    wrap.appendChild(p);
    chatLog.appendChild(wrap);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function analyzeArt() {
    const used = state.pixels.filter(Boolean);
    if (!used.length) {
      return "まだ何も描かれていないよ。まずは外形を1色で作って、16pxプレビューで読める形か確認してみよう。";
    }

    const colors = new Set(used);
    let minX = state.size, minY = state.size, maxX = -1, maxY = -1;
    let edgePixels = 0;

    for (let y = 0; y < state.size; y++) {
      for (let x = 0; x < state.size; x++) {
        if (!state.pixels[y * state.size + x]) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        if (x === 0 || y === 0 || x === state.size - 1 || y === state.size - 1) edgePixels++;
      }
    }

    const fillRate = Math.round((used.length / (state.size * state.size)) * 100);
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const notes = [];

    notes.push("使用色 " + colors.size + "色・塗り " + fillRate + "%・絵の範囲 " + width + "×" + height + "px。");
    if (colors.size > 10) notes.push("カーソルとしては色数が多め。小サイズでは5〜8色くらいまで整理すると形が読みやすいよ。");
    else notes.push("色数はカーソル向けに扱いやすい範囲。");

    if (edgePixels > 0) notes.push("端に触れているピクセルがあるので、1px余白を作ると切れて見えにくい。");
    else notes.push("外周に余白があって安全。");

    const hs = state.pixels[state.hotspot.y * state.size + state.hotspot.x];
    if (!hs) notes.push("クリック位置が透明部分にあるよ。意図した場所ならOKだけど、先端に合わせると操作感が分かりやすい。");

    return notes.join(" ");
  }

  function assistantReply(text) {
    const q = text.toLowerCase();

    if (q.includes("診断") || q.includes("チェック")) return analyzeArt();
    if (q.includes("輪郭")) return "輪郭は1px幅を基本にして、外側を暗色・内側を明色にすると小さいサイズでも形が残りやすいよ。曲線は 1→1→2px の階段を意識するとドット感がきれい。";
    if (q.includes("色") || q.includes("カラー")) return "まず基準色、暗い輪郭色、明るいハイライト色の3段階を作るのがおすすめ。似た色を増やしすぎない方が16〜32pxでは強いよ。";
    if (q.includes("小さ") || q.includes("見やす") || q.includes("見え")) return "16pxプレビューを基準に確認してみて。細い突起は1px以上、重要なシルエットは2〜3pxの塊を残すと潰れにくいよ。";
    if (q.includes("透明")) return "背景は透明のままでOK。カーソルの外周に半透明は使わず、完全透明か不透明に寄せると輪郭がシャープに見えやすいよ。";
    if (q.includes("カーソル") || q.includes("クリック")) return "「クリック位置」ツールで赤いマークを先端に置いてね。矢印なら左上の先端、照準なら中心など、操作したい位置に合わせるのが大事。";
    if (q.includes("ドット")) return "アンチエイリアスを描かず、ピクセルの階段を意識するとドット絵らしくなるよ。斜線は 1-1-1 や 1-2-1 のように規則を揃えるときれい。";
    if (q.includes("影") || q.includes("立体")) return "光源を左上など1方向に決めて、反対側に暗色を置いてみて。32pxカーソルなら影色は1段階だけでも十分立体感が出るよ。";

    return "その方向なら、まずシルエット → 輪郭 → 3〜6色くらいで陰影、の順に作ると崩れにくいよ。必要なら「今の絵を診断」も押してみて！";
  }

  function handleAssistantSubmit(text) {
    const value = String(text || "").trim();
    if (!value) return;
    addChat("user", value);
    setTimeout(function () {
      addChat("assistant", assistantReply(value));
    }, 180);
  }

  document.querySelectorAll(".tool").forEach(function (button) {
    button.addEventListener("click", function () {
      setTool(button.dataset.tool);
    });
  });

  colorPicker.addEventListener("input", function () {
    state.color = colorPicker.value.toUpperCase();
    state.transparentInk = false;
    syncColorUI();
  });

  hexInput.addEventListener("change", function () {
    const color = normalizeHex(hexInput.value);
    if (!color) {
      syncColorUI();
      return;
    }
    state.color = color;
    state.transparentInk = false;
    syncColorUI();
  });

  document.getElementById("transparentBtn").addEventListener("click", function () {
    state.transparentInk = true;
    syncColorUI();
  });

  sizeSelect.addEventListener("change", function () {
    resizeCanvas(sizeSelect.value);
  });

  zoomRange.addEventListener("input", function () {
    state.zoom = Number(zoomRange.value);
    updateCanvasDimensions();
    render();
  });

  gridToggle.addEventListener("change", function () {
    state.showGrid = gridToggle.checked;
    render();
  });

  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", finishAction);
  canvas.addEventListener("pointercancel", finishAction);
  canvas.addEventListener("pointerleave", function () {
    coordLabel.textContent = "--, --";
  });
  canvas.addEventListener("contextmenu", function (event) {
    event.preventDefault();
  });

  document.getElementById("undoBtn").addEventListener("click", undo);
  document.getElementById("redoBtn").addEventListener("click", redo);
  document.getElementById("clearBtn").addEventListener("click", clearCanvas);
  document.getElementById("saveBtn").addEventListener("click", function () {
    persist();
    showToast("ブラウザに保存しました");
  });
  document.getElementById("exportPngBtn").addEventListener("click", function () {
    exportPng(1);
  });
  document.getElementById("exportCurBtn").addEventListener("click", exportCur);

  importInput.addEventListener("change", function () {
    importImage(importInput.files && importInput.files[0]);
    importInput.value = "";
  });

  document.getElementById("diagnoseBtn").addEventListener("click", function () {
    addChat("assistant", analyzeArt());
  });

  document.querySelectorAll("[data-prompt]").forEach(function (button) {
    button.addEventListener("click", function () {
      handleAssistantSubmit(button.dataset.prompt);
    });
  });

  document.getElementById("assistantForm").addEventListener("submit", function (event) {
    event.preventDefault();
    const text = assistantText.value;
    assistantText.value = "";
    handleAssistantSubmit(text);
  });

  document.addEventListener("keydown", function (event) {
    if (event.target && /input|select|textarea/i.test(event.target.tagName)) return;
    const key = event.key.toLowerCase();

    if ((event.ctrlKey || event.metaKey) && key === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
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
    if (key === "h") setTool("hotspot");
  });

  loadPersisted();
  if (!state.pixels.length) state.pixels = emptyPixels(state.size);
  buildPalette();
  updateCanvasDimensions();
  updateUndoButtons();
  render();

  requestAnimationFrame(function () {
    canvasStage.scrollLeft = Math.max(0, (canvasStage.scrollWidth - canvasStage.clientWidth) / 2);
    canvasStage.scrollTop = Math.max(0, (canvasStage.scrollHeight - canvasStage.clientHeight) / 2);
  });
})();
