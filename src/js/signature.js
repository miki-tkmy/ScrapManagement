// スクラップ業者専用 手書き電子署名パッドクラス (signature.js)
class SignaturePad {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext("2d");
    this.isDrawing = false;
    this.hasDrawn = false;
    this.lastPoint = null;

    this.initCanvas();
    this.bindEvents();
  }

  initCanvas() {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width > 0 ? rect.width : 360;
    const height = rect.height > 0 ? rect.height : 180;

    this.canvas.width = width * ratio;
    this.canvas.height = height * ratio;
    this.ctx.scale(ratio, ratio);

    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";
    this.ctx.lineWidth = 2.5;
    this.ctx.strokeStyle = "#1F1235";
  }

  bindEvents() {
    this.canvas.addEventListener("mousedown", e => this.startDrawing(e));
    this.canvas.addEventListener("mousemove", e => this.draw(e));
    window.addEventListener("mouseup", () => this.stopDrawing());

    // タッチ対応 (iPhone Safari)
    this.canvas.addEventListener("touchstart", e => {
      e.preventDefault();
      this.startDrawing(e.touches[0]);
    }, { passive: false });

    this.canvas.addEventListener("touchmove", e => {
      e.preventDefault();
      this.draw(e.touches[0]);
    }, { passive: false });

    window.addEventListener("touchend", () => this.stopDrawing());
  }

  getPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  startDrawing(e) {
    this.isDrawing = true;
    this.hasDrawn = true;
    this.lastPoint = this.getPoint(e);
  }

  draw(e) {
    if (!this.isDrawing) return;
    const currentPoint = this.getPoint(e);

    this.ctx.beginPath();
    this.ctx.moveTo(this.lastPoint.x, this.lastPoint.y);
    this.ctx.lineTo(currentPoint.x, currentPoint.y);
    this.ctx.stroke();

    this.lastPoint = currentPoint;
  }

  stopDrawing() {
    this.isDrawing = false;
  }

  clear() {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    this.ctx.clearRect(0, 0, this.canvas.width / ratio, this.canvas.height / ratio);
    this.hasDrawn = false;
  }

  isEmpty() {
    return !this.hasDrawn;
  }

  toDataURL() {
    if (!this.hasDrawn) return null;
    return this.canvas.toDataURL("image/png");
  }

  loadFromDataURL(dataUrl) {
    if (!dataUrl) {
      this.clear();
      return;
    }
    const img = new Image();
    img.onload = () => {
      this.clear();
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      this.ctx.drawImage(img, 0, 0, this.canvas.width / ratio, this.canvas.height / ratio);
      this.hasDrawn = true;
    };
    img.src = dataUrl;
  }
}

if (typeof window !== "undefined") {
  window.SignaturePad = SignaturePad;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { SignaturePad };
}
